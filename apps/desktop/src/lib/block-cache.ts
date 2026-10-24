import { useEffect, useSyncExternalStore } from 'react'
import type { BlockInfo } from './types'
import { db } from './storage'
import { getState } from '../state/store'

/**
 * Text of blocks referenced with `((`. Looked up in the index in small batches and
 * refreshed whenever the index changes.
 */
const cache = new Map<string, BlockInfo | null>()
const listeners = new Set<() => void>()
let queued = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let seenVersion = -1

function fetchQueued() {
  const ids = [...queued]
  queued = new Set()
  db()
    .blockInfos(ids)
    .then((infos) => {
      ids.forEach((id) => cache.set(id, null))
      infos.forEach((b) => cache.set(b.id, b))
      listeners.forEach((l) => l())
    })
    .catch(console.error)
}

function request(id: string) {
  queued.add(id)
  clearTimeout(timer)
  timer = setTimeout(fetchQueued, 30)
}

export function useBlockInfo(id: string | null): BlockInfo | null | undefined {
  const version = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (id ? cache.get(id) : undefined),
  )
  const indexVersion = getState().indexVersion
  useEffect(() => {
    if (!id) return
    if (seenVersion !== indexVersion) {
      seenVersion = indexVersion
      cache.clear()
    }
    if (!cache.has(id)) request(id)
  }, [id, indexVersion])
  return version
}

export async function blockInfo(id: string): Promise<BlockInfo | null> {
  if (cache.get(id)) return cache.get(id)!
  const [info] = await db().blockInfos([id])
  cache.set(id, info ?? null)
  return info ?? null
}
