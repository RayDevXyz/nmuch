import type { BlockInfo, Hit, Link, Page, PageMeta, Ref, Storage, TagCount } from '../types'
import { connectCore, isTauri, type CoreClient } from '../core/client'

export { isTauri }

let storage: Storage | null = null
let core: CoreClient | null = null

/** Page metadata as the core stores it (timestamps are derived from the update log). */
export const metaOf = (p: Page): PageMeta => ({
  title: p.title,
  icon: p.icon,
  parentId: p.parentId,
  key: p.key,
  favorite: p.favorite,
  archived: p.archived,
  trashedAt: p.trashedAt,
})

function createStorage(c: CoreClient): Storage {
  return {
    kind: c.kind === 'tauri' ? 'sqlite' : 'dev',
    location: () => c.call<string>('dbPath'),
    listPages: () => c.call<Page[]>('listPages'),
    createPage: (page) => c.call<string>('createPage', { id: page.id, meta: metaOf(page) }).then(() => {}),
    updatePage: (id, patch) => c.call<void>('updatePage', { id, patch }),
    deletePages: (ids) => c.call<void>('deletePages', { ids }),
    backlinks: (pageId) => c.call<Ref[]>('backlinks', { pageId }),
    mentions: (pageId, title) => c.call<Ref[]>('mentions', { pageId, title }),
    links: () => c.call<Link[]>('links'),
    tags: () => c.call<TagCount[]>('tags'),
    pagesWithTag: (tag) => c.call<string[]>('pagesWithTag', { tag }),
    search: (query, limit) => c.call<Hit[]>('search', { query, limit }),
    blockInfos: (ids) => c.call<BlockInfo[]>('blockInfos', { ids }),
  }
}

export async function initStorage(): Promise<Storage> {
  if (storage) return storage
  core = await connectCore()
  storage = createStorage(core)
  return storage
}

export function db(): Storage {
  if (!storage) throw new Error('storage not initialised')
  return storage
}

export function coreClient(): CoreClient {
  if (!core) throw new Error('storage not initialised')
  return core
}

export async function openExternal(url: string) {
  if (isTauri) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch (e) {
      console.error(e)
    }
  }
  window.open(url, '_blank', 'noopener')
}
