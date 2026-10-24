import type { Storage } from '../types'
import { createBrowserStorage } from './browser'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let storage: Storage | null = null

export async function initStorage(): Promise<Storage> {
  if (storage) return storage
  if (isTauri) {
    const { createTauriStorage } = await import('./tauri')
    storage = createTauriStorage()
  } else {
    storage = await createBrowserStorage()
  }
  return storage
}

export function db(): Storage {
  if (!storage) throw new Error('storage not initialised')
  return storage
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
