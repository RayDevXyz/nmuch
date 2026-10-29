import { useCallback, useEffect, useRef, useState } from 'react'
import { coreClient } from '../lib/storage'
import { queryDatabase } from './api'
import type { DatabaseResult, View } from './types'

/** A view with no filters or sorts: every row (row pages use it to find their own values). */
export const ALL_ROWS: View = { id: '', name: '', type: 'table', order: '', filters: [], sorts: [] }

/**
 * Run a database view and keep it live: any change committed by the core (a cell edited here,
 * a lesson ticked in another window, a row added from a widget) triggers a re-query.
 */
export function useDatabase(databaseId: string, viewId?: string, override?: View) {
  const [result, setResult] = useState<DatabaseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const overrideKey = override ? JSON.stringify(override) : ''

  const refresh = useCallback(async () => {
    const n = ++seq.current
    try {
      let r: DatabaseResult
      try {
        r = await queryDatabase(databaseId, override ? undefined : viewId || undefined, override)
      } catch (e) {
        // The view was deleted elsewhere: fall back to the first view.
        if (!viewId || override) throw e
        r = await queryDatabase(databaseId)
      }
      if (n === seq.current) {
        setResult(r)
        setError(null)
      }
    } catch (e) {
      if (n === seq.current) setError(String(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId, viewId, overrideKey])

  useEffect(() => {
    void refresh()
    let t: ReturnType<typeof setTimeout> | undefined
    const off = coreClient().onEvent(() => {
      clearTimeout(t)
      t = setTimeout(() => void refresh(), 60)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [refresh])

  return { result, error, refresh }
}
