import { useEffect, useState, useSyncExternalStore } from 'react'
import { coreClient } from '../lib/storage'
import { useApp } from '../state/store'

/**
 * The user's Burrow (self-hosted bookmarks and web archive). BrainWaves' host talks to it with
 * the token stored in the workspace (`bw_api::burrow`); the web app only sees results.
 */

export interface BurrowTag {
  id?: number
  name: string
  source?: string
  count?: number
}
export interface Bookmark {
  id: number
  type: 'link' | 'note' | 'file'
  url: string | null
  title: string | null
  description: string | null
  note: string | null
  image_url: string | null
  favicon: string | null
  site_name: string | null
  author: string | null
  has_archive: number | boolean
  has_reader?: number | boolean
  collection_id: number | null
  favorite: number
  archived: number
  created_at: number
  tags: BurrowTag[]
}
export interface Collection {
  id: number
  name: string
  icon?: string
  count?: number
}

// async: a call before storage is ready rejects instead of throwing.
const call = async <T>(command: string, args: Record<string, unknown> = {}) => coreClient().call<T>(command, args)

// ---- connection (shared state: the panel, cards and menus all follow it)

let connection: { url: string } | null | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export async function refreshConnection() {
  connection = await call<{ url: string } | null>('burrowConnection').catch(() => null)
  emit()
  return connection
}
export function useBurrow(): { url: string } | null | undefined {
  const c = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => connection,
  )
  // Ask once the app's storage is up.
  const ready = useApp((s) => s.ready)
  useEffect(() => {
    if (ready && connection === undefined) void refreshConnection()
  }, [ready])
  return c
}
export async function connect(url: string, token: string) {
  await call('burrowSetConnection', { url, key: token })
  try {
    await call('burrowTest')
  } catch (e) {
    await call('burrowSetConnection', { url: '', key: '' })
    await refreshConnection()
    throw e
  }
  cache.clear()
  return refreshConnection()
}
export async function disconnect() {
  await call('burrowSetConnection', { url: '', key: '' })
  cache.clear()
  return refreshConnection()
}

// ---- reads (cached briefly: cards and the panel ask often)

const cache = new Map<string, { at: number; p: Promise<unknown> }>()
function cached<T>(key: string, load: () => Promise<T>, ttl = 60_000): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>
  const p = load()
  p.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), p })
  return p
}
const get = <T>(path: string, query: Record<string, string | number> = {}) => call<T>('burrowGet', { path, query })

export const listBookmarks = (query: { q?: string; tag?: string; collection?: string | number; limit?: number; offset?: number; favorite?: number; type?: string }) =>
  cached(`list:${JSON.stringify(query)}`, () => get<{ items: Bookmark[]; hasMore: boolean }>('bookmarks', { limit: 40, ...query } as Record<string, string | number>), 20_000)
export const getBookmark = (id: number) => cached(`b:${id}`, () => get<Bookmark>(`bookmarks/${id}`))
export const lookup = (url: string) => get<Bookmark | null>('bookmarks/lookup', { url })
export const burrowTags = () => cached('tags', () => get<BurrowTag[]>('tags'))
export const collections = () => cached('collections', () => get<Collection[]>('collections'))

export async function saveToBurrow(item: { url?: string; note?: string; title?: string; tags?: string[]; collectionId?: number | null }) {
  const r = await call<Bookmark & { duplicate?: boolean }>('burrowSave', { ...item, collectionId: item.collectionId ?? undefined })
  for (const k of [...cache.keys()]) if (k.startsWith('list:') || k === 'tags') cache.delete(k)
  return r
}

/** A bookmark's links in the user's Burrow (its page there, the archived copy). */
export const burrowLinks = (base: string, b: { id: number }) => ({
  item: `${base}/#/b/${b.id}`,
  archive: `${base}/api/bookmarks/${b.id}/archive`,
})

export const domainOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

/** Load something from Burrow in a component: the value, the error, and whether it's loading. */
export function useBurrowData<T>(load: (() => Promise<T>) | null, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!load })
  useEffect(() => {
    if (!load) return setState({ loading: false })
    let live = true
    setState((s) => ({ ...s, loading: true }))
    load().then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ error: String(e).replace(/^Error:\s*/, ''), loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

/** What a drag from the Burrow panel carries (also a plain link, for other drop targets). */
export const DRAG = 'application/x-bw-burrow'
export function dragBookmark(e: React.DragEvent, b: Bookmark) {
  e.dataTransfer.setData(DRAG, JSON.stringify({ id: b.id, url: b.url, title: b.title }))
  if (b.url) {
    e.dataTransfer.setData('text/uri-list', b.url)
    e.dataTransfer.setData('text/plain', b.url)
  }
  e.dataTransfer.effectAllowed = 'copy'
}
export function droppedBookmark(data: DataTransfer): { id: number; url: string | null; title: string | null } | null {
  try {
    const raw = data.getData(DRAG)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** The page block for a bookmark (a `burrow:card` widget; it keeps a little to show offline). */
export const cardContent = (b: { id: number; url: string | null; title: string | null }) => [
  { type: 'widget', attrs: { widget: 'burrow:card', settings: JSON.stringify({ id: b.id, url: b.url, title: b.title }) } },
  { type: 'paragraph' },
]
