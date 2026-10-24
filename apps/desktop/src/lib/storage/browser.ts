import type { Block, BlockWrite, Hit, Link, Page, Ref, Storage, TagCount } from '../types'

// IndexedDB fallback so the UI also runs in a plain browser (`npm run dev`).
// Everything is cached in memory; writes go through to IndexedDB.

const DB_NAME = 'nimbus'
const VERSION = 1

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(DB_NAME, VERSION)
      r.onupgradeneeded = () => {
        const db = r.result
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('blocks')) db.createObjectStore('blocks', { keyPath: 'id' })
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

export async function createBrowserStorage(): Promise<Storage> {
  const db = await openDb()
  const pages = new Map<string, Page>()
  const blocks = new Map<string, BlockWrite>()
  if (db) {
    const tx = db.transaction(['pages', 'blocks'], 'readonly')
    const [ps, bs] = await Promise.all([
      req(tx.objectStore('pages').getAll() as IDBRequest<Page[]>),
      req(tx.objectStore('blocks').getAll() as IDBRequest<BlockWrite[]>),
    ])
    ps.forEach((p) => pages.set(p.id, p))
    bs.forEach((b) => blocks.set(b.id, b))
  }

  const write = (fn: (pagesStore: IDBObjectStore, blocksStore: IDBObjectStore) => void) =>
    new Promise<void>((resolve, reject) => {
      if (!db) return resolve()
      const tx = db.transaction(['pages', 'blocks'], 'readwrite')
      fn(tx.objectStore('pages'), tx.objectStore('blocks'))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

  const alive = (pageId: string) => {
    const p = pages.get(pageId)
    return !!p && p.trashedAt == null
  }
  const strip = (b: BlockWrite): Block => ({ id: b.id, pageId: b.pageId, type: b.type, text: b.text, props: b.props, key: b.key })
  const byUpdated = (a: { pageId: string }, b: { pageId: string }) =>
    (pages.get(b.pageId)?.updatedAt ?? 0) - (pages.get(a.pageId)?.updatedAt ?? 0)

  return {
    kind: 'browser',
    location: async () => (db ? 'Browser storage (IndexedDB)' : 'Memory only (not persisted)'),
    listPages: async () => [...pages.values()].sort(byKey),
    upsertPage: async (page) => {
      pages.set(page.id, { ...page })
      await write((p) => p.put(page))
    },
    deletePages: async (ids) => {
      const set = new Set(ids)
      const doomed = [...blocks.values()].filter((b) => set.has(b.pageId)).map((b) => b.id)
      ids.forEach((id) => pages.delete(id))
      doomed.forEach((id) => blocks.delete(id))
      await write((p, b) => {
        ids.forEach((id) => p.delete(id))
        doomed.forEach((id) => b.delete(id))
      })
    },
    getBlocks: async (pageId) => [...blocks.values()].filter((b) => b.pageId === pageId).sort(byKey).map(strip),
    saveBlocks: async (pageId, writes, deletes, updatedAt) => {
      deletes.forEach((id) => blocks.delete(id))
      writes.forEach((w) => blocks.set(w.id, w))
      const page = pages.get(pageId)
      if (page) pages.set(pageId, { ...page, updatedAt })
      await write((p, b) => {
        deletes.forEach((id) => b.delete(id))
        writes.forEach((w) => b.put(w))
        const pg = pages.get(pageId)
        if (pg) p.put(pg)
      })
    },
    backlinks: async (pageId) =>
      [...blocks.values()]
        .filter((b) => b.pageId !== pageId && alive(b.pageId) && b.links.includes(pageId))
        .sort(byUpdated)
        .map((b): Ref => ({ pageId: b.pageId, blockId: b.id, text: b.plain.slice(0, 400) })),
    mentions: async (pageId, title) => {
      const t = title.trim().toLowerCase()
      if (t.length < 3) return []
      return [...blocks.values()]
        .filter((b) => b.pageId !== pageId && alive(b.pageId) && !b.links.includes(pageId) && b.plain.toLowerCase().includes(t))
        .sort(byUpdated)
        .slice(0, 50)
        .map((b) => ({ pageId: b.pageId, blockId: b.id, text: b.plain.slice(0, 400) }))
    },
    links: async () => {
      const seen = new Set<string>()
      const out: Link[] = []
      blocks.forEach((b) =>
        b.links.forEach((t) => {
          const k = b.pageId + '>' + t
          if (!seen.has(k)) {
            seen.add(k)
            out.push({ source: b.pageId, target: t })
          }
        }),
      )
      return out
    },
    tags: async () => {
      const m = new Map<string, Set<string>>()
      blocks.forEach((b) => {
        if (!alive(b.pageId)) return
        b.tags.forEach((t) => {
          if (!m.has(t)) m.set(t, new Set())
          m.get(t)!.add(b.pageId)
        })
      })
      return [...m.entries()]
        .map(([tag, s]): TagCount => ({ tag, count: s.size }))
        .sort((a, b) => a.tag.localeCompare(b.tag))
    },
    pagesWithTag: async (tag) => [...new Set([...blocks.values()].filter((b) => b.tags.includes(tag)).map((b) => b.pageId))],
    search: async (query, limit) => {
      const q = query.trim().toLowerCase()
      if (!q) return []
      const hits: Hit[] = []
      ;[...pages.values()]
        .filter((p) => p.trashedAt == null && p.title.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .forEach((p) => hits.push({ pageId: p.id, blockId: null, text: p.title }))
      ;[...blocks.values()]
        .filter((b) => alive(b.pageId) && b.plain.toLowerCase().includes(q))
        .sort(byUpdated)
        .slice(0, limit)
        .forEach((b) => hits.push({ pageId: b.pageId, blockId: b.id, text: b.plain.slice(0, 2000) }))
      return hits
    },
  }
}
