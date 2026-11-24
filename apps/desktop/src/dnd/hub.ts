import { generateHTML, type JSONContent } from '@tiptap/core'
import { schemaExtensions } from '@brainwaves/editor'
import { coreClient } from '../lib/storage'
import { ancestors, withPage } from '../state/actions'
import { getState } from '../state/store'
import { getRoles } from './api'
import { allEntries, enabledSources, entries, type Category } from './fivee'
import { createRoom, getCampaignTable, getTable, setCampaignTable, type Table } from './live'

/**
 * The players' hub on the table server: what BrainWaves publishes there for a campaign.
 *
 * - **The compendium:** the player-facing part of the DM's 5etools (never monsters), from the
 *   books turned on in the compendium's settings. Players browse it without 5etools running.
 * - **Journal pages:** any page, published as an expedition log, the story so far, or a page.
 *
 * Everything goes through BrainWaves' own side (`tableSend`), like making a room, so a reverse
 * proxy's cross-site rules don't get in the way; the browser asks directly only as a fallback.
 */

/** What players may read. */
export const HUB_CATEGORIES: { id: Category; label: string }[] = [
  { id: 'spell', label: 'Spells' },
  { id: 'item', label: 'Items' },
  { id: 'race', label: 'Races' },
  { id: 'class', label: 'Classes' },
  { id: 'background', label: 'Backgrounds' },
  { id: 'feat', label: 'Feats' },
  { id: 'condition', label: 'Conditions' },
]

export type JournalKind = 'log' | 'story' | 'page'
export const KIND_LABEL: Record<JournalKind, string> = { log: 'Expedition log', story: 'Story so far', page: 'Page' }

export interface CompendiumMeta {
  publishedAt: number
  sources: string[]
  counts: Record<string, number>
}

async function table(): Promise<Table> {
  const t = await getTable()
  if (!t) throw new Error('Set up your table server first: open a campaign and its Players’ table panel.')
  return t
}

/** A call to the table server's hub, through BrainWaves (or the browser, as a fallback). */
async function send<T>(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: string): Promise<T> {
  const t = await table()
  const server = t.server.replace(/\/+$/, '')
  try {
    return await coreClient().call<T>('tableSend', { server, key: t.key, method, path, body })
  } catch (e) {
    const m = String(e).replace(/^Error:\s*/, '')
    if (!m.startsWith('unreachable:') && !m.includes('unknown command')) throw new Error(m)
  }
  const res = await fetch(`${server}${path}`, { method, headers: { authorization: `Bearer ${t.key}`, 'content-type': 'application/json' }, body })
  if (res.status === 401) throw new Error('The table server refused the DM key.')
  if (res.status === 404) throw new Error('The table server doesn’t know this campaign’s room. Go live once, then try again.')
  if (!res.ok) throw new Error(`The table server answered ${res.status}.`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/** The campaign's room on the table server, made if it doesn't exist yet. */
export async function ensureRoom(campaignId: string): Promise<string> {
  const t = await table()
  const ct = await getCampaignTable(campaignId)
  const name = getState().pages[campaignId]?.title || 'Campaign'
  const code = await createRoom(t.server.replace(/\/+$/, ''), t.key, { name, code: ct.room ?? undefined })
  if (ct.room !== code) await setCampaignTable(campaignId, { room: code })
  return code
}

// ---------------------------------------------------------------- the compendium

export async function compendiumStatus(campaignId: string): Promise<CompendiumMeta | null> {
  const { room } = await getCampaignTable(campaignId)
  if (!room) return null
  const m = await send<CompendiumMeta | null>('GET', `/api/rooms/${room}/compendium`)
  return m && m.publishedAt ? m : null
}

/**
 * Publish the compendium: each chosen category from the books turned on, then the list of books.
 * Categories left out are removed from the hub. `progress` is told what's being sent.
 */
export async function publishCompendium(campaignId: string, cats: Category[], progress: (msg: string) => void): Promise<CompendiumMeta> {
  const room = await ensureRoom(campaignId)
  for (const c of cats) {
    const label = HUB_CATEGORIES.find((x) => x.id === c)?.label ?? c
    progress(`Reading ${label.toLowerCase()}…`)
    const list = await entries(c)
    progress(`Sending ${list.length} ${label.toLowerCase()}…`)
    await send('PUT', `/api/rooms/${room}/compendium/${c}`, JSON.stringify(list.map((e) => e.raw)))
  }
  const on = await enabledSources()
  const sources = on ? [...on] : [...new Set((await Promise.all(cats.map((c) => allEntries(c)))).flat().map((e) => e.source))]
  return send<CompendiumMeta>('PUT', `/api/rooms/${room}/compendium`, JSON.stringify({ sources: sources.sort(), categories: cats }))
}

export async function removeCompendium(campaignId: string) {
  const { room } = await getCampaignTable(campaignId)
  if (room) await send('DELETE', `/api/rooms/${room}/compendium`)
}

// ---------------------------------------------------------------- journal pages

export interface JournalEntry {
  id: string
  title: string
  icon: string
  kind: JournalKind
  published: number
  updated: number
}

/** The pages published in a campaign's journal. */
export async function journalList(campaignId: string): Promise<JournalEntry[]> {
  const { room } = await getCampaignTable(campaignId)
  if (!room) return []
  const list = await send<JournalEntry[]>('GET', `/api/rooms/${room}/journal`)
  return Array.isArray(list) ? list : []
}

/** The campaign a page belongs to: the nearest campaign above it (or itself). */
export function campaignOf(pageId: string): string | null {
  const roles = getRoles()
  const chain = [getState().pages[pageId], ...ancestors(pageId)].filter(Boolean)
  return chain.find((p) => roles[p!.id] === 'campaign')?.id ?? null
}

/** Every campaign in the workspace. */
export function campaigns(): { id: string; title: string }[] {
  const roles = getRoles()
  const pages = getState().pages
  return Object.keys(roles)
    .filter((id) => roles[id] === 'campaign' && pages[id] && pages[id].trashedAt == null)
    .map((id) => ({ id, title: pages[id].title || 'Untitled campaign' }))
}

/** Where a page was published: kept in the page itself. */
export interface Published {
  campaignId: string
  kind: JournalKind
  at: number
}

export async function publishedState(pageId: string): Promise<Published | null> {
  return withPage(pageId, (s) => (s.doc.getMap('tablePublish').get('state') as Published | undefined) ?? null)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A page as HTML for players. Links to pages and blocks become their titles; 5e cards become
 * links into the hub's compendium; things that only work in BrainWaves (databases, widgets, maps
 * of content, buttons, formulas) are left out.
 */
export async function pageHtml(pageId: string): Promise<string> {
  const blocks = await withPage(pageId, (s) => s.notesJSON(true).flatMap((n) => n.content ?? []))
  const html = generateHTML({ type: 'doc', content: blocks as JSONContent[] }, schemaExtensions())
  const dom = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = dom.getElementById('root')!
  const pages = getState().pages
  for (const el of [...root.querySelectorAll('[data-type="ref"]')]) {
    const target = el.getAttribute('data-target') ?? ''
    el.replaceWith(dom.createTextNode(el.getAttribute('data-kind') === 'page' ? pages[target]?.title || 'a page' : '…'))
  }
  for (const el of [...root.querySelectorAll('[data-type="page-link"]')]) {
    const p = pages[el.getAttribute('data-page-id') ?? '']
    const s = dom.createElement('p')
    s.textContent = p ? `${p.icon ? p.icon + ' ' : ''}${p.title || 'Untitled'}` : ''
    el.replaceWith(s)
  }
  for (const el of [...root.querySelectorAll('[data-type="widget"]')]) {
    // A 5e card (a compendium entry in the page) becomes a link the hub opens.
    let card: { cat?: string; name?: string; source?: string } = {}
    try {
      card = JSON.parse(el.getAttribute('data-settings') || '{}')
    } catch {
      /* not a card */
    }
    if (card.cat && card.name && card.cat !== 'monster') {
      const p = dom.createElement('p')
      p.innerHTML = `<a class="hub-ref" data-cat="${esc(card.cat)}" data-name="${esc(card.name)}" data-source="${esc(card.source ?? '')}">${esc(card.name)}</a>`
      el.replaceWith(p)
    } else el.remove()
  }
  for (const el of [...root.querySelectorAll('[data-type="database"], [data-type="moc"], [data-type="button"], [data-type="formula"]')]) el.remove()
  for (const el of [...root.querySelectorAll('[data-id]')]) el.removeAttribute('data-id')
  return root.innerHTML
}

/** Publish (or update) a page in a campaign's journal. */
export async function publishPage(pageId: string, campaignId: string, kind: JournalKind): Promise<void> {
  const room = await ensureRoom(campaignId)
  const page = getState().pages[pageId]
  const html = await pageHtml(pageId)
  await send('PUT', `/api/rooms/${room}/journal/${pageId}`, JSON.stringify({ title: page?.title || 'Untitled', icon: page?.icon ?? '', kind, html }))
  await withPage(pageId, (s) => {
    s.doc.getMap('tablePublish').set('state', { campaignId, kind, at: Date.now() } satisfies Published)
    return s.flush()
  })
}

export async function unpublishPage(pageId: string): Promise<void> {
  const st = await publishedState(pageId)
  if (st) {
    const { room } = await getCampaignTable(st.campaignId)
    if (room) await send('DELETE', `/api/rooms/${room}/journal/${pageId}`)
  }
  await withPage(pageId, (s) => {
    s.doc.getMap('tablePublish').delete('state')
    return s.flush()
  })
}
