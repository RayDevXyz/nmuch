import { createRow } from '../database/api'
import type { DatabaseResult } from '../database/types'
import { markdownToContent } from '../lib/convert'
import { uid } from '../lib/id'
import { ancestors, createPage, withPage } from '../state/actions'
import { getState } from '../state/store'
import { campaignData, type CampaignData } from './context'

/**
 * Gemini's world building made into the campaign's own pages: NPCs, locations and factions as
 * rows of the campaign's databases (with their role, attitude, kind, goal, and where they live or
 * whom they serve), lore as pages under the campaign, and text written into a page.
 */

export type WorldKind = 'npc' | 'location' | 'faction' | 'lore'
export interface WorldItem {
  kind: WorldKind
  title: string
  /** NPCs */
  role?: string
  attitude?: string
  status?: string
  /** Locations: region, city, village, dungeon, wilderness, landmark. */
  locationKind?: string
  /** Factions */
  goal?: string
  /** An NPC's location and faction (titles). */
  location?: string
  faction?: string
  /** The page itself, in Markdown. Links to other pages as [[Title]]. */
  body: string
  /** Pick it (in a preview). */
  keep?: boolean
}

export const KIND_LABEL: Record<WorldKind, string> = { npc: 'NPC', location: 'Location', faction: 'Faction', lore: 'Lore page' }

/** Wait until the app knows a page the core just made. */
export async function waitFor(id: string) {
  for (let i = 0; i < 60 && !getState().pages[id]; i++) await new Promise((r) => setTimeout(r, 100))
}

/** Every page of the campaign by title (lower case), for [[links]]. */
export function titlesIn(campaignId: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of Object.values(getState().pages)) {
    if (p.trashedAt != null || !p.title) continue
    if (p.id === campaignId || ancestors(p.id).some((a) => a.id === campaignId)) out.set(p.title.toLowerCase(), p.id)
  }
  return out
}

const optionId = (db: DatabaseResult | null, prop: string, name?: string) => {
  if (!db || !name) return undefined
  const p = db.properties.find((x) => x.id === prop)
  const n = name.toLowerCase().trim()
  return p?.options?.find((o) => o.id === n || o.name.toLowerCase() === n)?.id
}
const relationId = (db: DatabaseResult | null, name: string) => db?.properties.find((p) => p.type === 'relation' && p.name === name)?.id

/** Write Markdown into a page: after what's there, or instead of it. */
export async function writeInto(pageId: string, markdown: string, mode: 'append' | 'replace', titles: Map<string, string>) {
  const content = markdownToContent(markdown, (t) => titles.get(t.toLowerCase()) ?? null) ?? []
  if (!content.length) return
  await withPage(pageId, (s) => {
    const before = mode === 'append' ? s.notesJSON().flatMap((n) => n.content ?? []) : []
    // An empty first paragraph (a new page) isn't kept.
    const kept = before.filter((b, i) => !(i === before.length - 1 && b.type === 'paragraph' && !b.content?.length))
    s.setContent({ type: 'doc', content: [...kept, ...content] })
    return s.flush()
  })
}

/** Make the items as the campaign's pages. Returns their ids, in the items' order. */
export async function createWorld(campaignId: string, items: WorldItem[], given?: CampaignData): Promise<string[]> {
  const d = given ?? (await campaignData(campaignId))
  const parts = d.campaign.parts
  if (!parts) throw new Error('This campaign has no NPC, location and faction databases yet.')
  const titles = titlesIn(campaignId)
  const ids = new Map<WorldItem, string>()
  const make = async (it: WorldItem) => {
    const id = uid()
    const title = it.title.trim() || 'Untitled'
    if (it.kind === 'location') {
      const k = optionId(d.locations, 'kind', it.locationKind)
      await createRow(parts.locations, id, title, k ? { kind: k } : {})
    } else if (it.kind === 'faction') {
      await createRow(parts.factions, id, title, it.goal ? { goal: it.goal } : {})
    } else if (it.kind === 'npc') {
      const values: Record<string, unknown> = {}
      if (it.role) values.role = it.role
      const att = optionId(d.npcs, 'attitude', it.attitude)
      if (att) values.attitude = att
      const st = optionId(d.npcs, 'status', it.status)
      if (st) values.status = st
      const loc = it.location && titles.get(it.location.toLowerCase())
      const locRel = relationId(d.npcs, 'Location')
      if (loc && locRel) values[locRel] = [loc]
      const fac = it.faction && titles.get(it.faction.toLowerCase())
      const facRel = relationId(d.npcs, 'Faction')
      if (fac && facRel) values[facRel] = [fac]
      await createRow(parts.npcs, id, title, values)
    } else {
      const p = await createPage({ parentId: campaignId, title, icon: '📜', open: false })
      ids.set(it, p.id)
      titles.set(title.toLowerCase(), p.id)
      return
    }
    ids.set(it, id)
    titles.set(title.toLowerCase(), id)
  }
  // Places and factions first, so the NPCs can say where they live and whom they serve.
  const order: WorldKind[] = ['location', 'faction', 'lore', 'npc']
  for (const k of order) for (const it of items.filter((x) => x.kind === k)) await make(it)
  for (const id of ids.values()) await waitFor(id)
  for (const it of items) {
    const id = ids.get(it)
    if (id && it.body?.trim()) await writeInto(id, it.body, 'replace', titles)
  }
  return items.map((it) => ids.get(it)!).filter(Boolean)
}
