import { invoke } from '@tauri-apps/api/core'
import type { Storage } from '../types'

/** SQLite storage through the Rust commands in src-tauri/src/db.rs */
export function createTauriStorage(): Storage {
  return {
    kind: 'sqlite',
    location: () => invoke('db_path'),
    listPages: () => invoke('list_pages'),
    upsertPage: (page) => invoke('upsert_page', { page }),
    deletePages: (ids) => invoke('delete_pages', { ids }),
    getBlocks: (pageId) => invoke('get_blocks', { pageId }),
    saveBlocks: (pageId, writes, deletes, updatedAt) => invoke('save_blocks', { pageId, writes, deletes, updatedAt }),
    backlinks: (pageId) => invoke('backlinks', { pageId }),
    mentions: (pageId, title) => invoke('mentions', { pageId, title }),
    links: () => invoke('links'),
    tags: () => invoke('tags'),
    pagesWithTag: (tag) => invoke('pages_with_tag', { tag }),
    search: (query, limit) => invoke('search', { query, limit }),
  }
}
