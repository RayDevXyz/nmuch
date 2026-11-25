import { queryDatabase } from '../database/api'
import type { DatabaseResult, Row } from '../database/types'
import { dndCampaign, type Campaign } from '../dnd/api'
import { pageMarkdown } from '../editor/Editor'
import { getState } from '../state/store'

/**
 * What Gemini is told about a campaign: its NPCs, locations, factions, story beats and sessions,
 * each with its facts and the start of its page. Kept to a size Gemini reads quickly.
 */

export interface CampaignData {
  campaign: Campaign
  npcs: DatabaseResult | null
  locations: DatabaseResult | null
  factions: DatabaseResult | null
  sessions: DatabaseResult | null
  beats: DatabaseResult | null
}

export async function campaignData(id: string): Promise<CampaignData> {
  const campaign = await dndCampaign(id)
  const p = campaign.parts
  const q = (db?: string) => (db ? queryDatabase(db).catch(() => null) : Promise.resolve(null))
  const [npcs, locations, factions, sessions, beats] = await Promise.all([q(p?.npcs), q(p?.locations), q(p?.factions), q(p?.sessions), q(p?.beats)])
  return { campaign, npcs, locations, factions, sessions, beats }
}

/** A row's values as readable facts ("Role: innkeeper; Location: Phandalin"). */
export function facts(db: DatabaseResult, row: Row): string {
  const out: string[] = []
  for (const prop of db.properties) {
    if (prop.type === 'title' || prop.type === 'rollup') continue
    const v = row.values[prop.id]
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    let text: string
    if (prop.type === 'select') text = prop.options?.find((o) => o.id === v)?.name ?? String(v)
    else if (prop.type === 'multiSelect' && Array.isArray(v)) text = v.map((x) => prop.options?.find((o) => o.id === x)?.name ?? x).join(', ')
    else if (prop.type === 'relation' && Array.isArray(v)) text = v.map((x) => db.related[x as string]?.title ?? getState().pages[x as string]?.title ?? '').filter(Boolean).join(', ')
    else text = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (text) out.push(`${prop.name}: ${text}`)
  }
  return out.join('; ')
}

const excerpt = (md: string, n: number) => {
  const t = md.replace(/\n{3,}/g, '\n\n').trim()
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t
}

/** The campaign as text for Gemini. `per` is how much of each page's text goes in. */
export async function campaignContext(id: string, per = 500): Promise<string> {
  const d = await campaignData(id)
  const lines: string[] = [`# Campaign: ${d.campaign.title}`]
  const overview = await pageMarkdown(id).catch(() => '')
  if (overview.trim()) lines.push(excerpt(overview, 1500))
  const section = async (title: string, db: DatabaseResult | null, withText: boolean) => {
    if (!db || !db.rows.length) return
    lines.push(`\n## ${title}`)
    const rows = db.rows.slice(0, 80)
    const texts = withText ? await Promise.all(rows.map((r) => pageMarkdown(r.id).catch(() => ''))) : []
    rows.forEach((r, i) => {
      const f = facts(db, r)
      lines.push(`- **${r.title || 'Untitled'}**${f ? ` (${f})` : ''}`)
      const t = texts[i] ? excerpt(texts[i], per) : ''
      if (t) lines.push(t.split('\n').map((l) => `  ${l}`).join('\n'))
    })
  }
  await section('NPCs', d.npcs, true)
  await section('Locations', d.locations, true)
  await section('Factions', d.factions, true)
  await section('Story beats', d.beats, false)
  await section('Sessions', d.sessions, false)
  return lines.join('\n')
}

/** The campaign a page belongs to: itself, or the campaign above it. */
export { campaignOf } from '../dnd/hub'
