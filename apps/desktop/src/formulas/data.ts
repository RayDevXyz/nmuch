import { useEffect, useState } from 'react'
import { queryDatabase } from '../database/api'
import type { DatabaseResult, Property } from '../database/types'
import { ALL_ROWS } from '../database/useDatabase'
import { coreClient } from '../lib/storage'
import { readProps } from '../properties/model'
import { withPage } from '../state/actions'
import { getState } from '../state/store'
import type { PageValues, Source, Value } from './lang'

/**
 * Where formulas get their values: page properties (from each page's doc) and database cells
 * (from the core's database queries). Results are cached until something changes, and every
 * change bumps a version that formulas on screen re-run on.
 */
let version = 0
const listeners = new Set<() => void>()
const props = new Map<string, Promise<Record<string, Value>>>()
const dbs = new Map<string, Promise<DatabaseResult>>()
let started = false

function start() {
  if (started) return
  started = true
  let t: ReturnType<typeof setTimeout> | undefined
  coreClient().onEvent((e) => {
    if ('pageId' in e) props.delete(e.pageId)
    else props.clear()
    dbs.clear()
    clearTimeout(t)
    t = setTimeout(() => {
      version++
      listeners.forEach((l) => l())
    }, 150)
  })
}

/** A number that changes whenever formula inputs may have changed. */
export function useFormulaVersion() {
  const [v, setV] = useState(version)
  useEffect(() => {
    start()
    const l = () => setV(version)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return v
}

/** A cell as a formula sees it: option names instead of ids, titles instead of row ids. */
function cell(p: Property, v: unknown, related: DatabaseResult['related']): Value {
  if (v === undefined || v === null) return null
  switch (p.type) {
    case 'select':
      return p.options?.find((o) => o.id === v)?.name ?? null
    case 'multiSelect':
      return (Array.isArray(v) ? v : [v]).map((id) => p.options?.find((o) => o.id === id)?.name ?? '').filter(Boolean)
    case 'relation':
      return (Array.isArray(v) ? v : [v]).map((id) => related[id as string]?.title ?? getState().pages[id as string]?.title ?? '').filter(Boolean)
    case 'checkbox':
      return v === true
    case 'number':
      return typeof v === 'number' ? v : Number(v)
    default:
      return Array.isArray(v) ? (v as Value[]) : typeof v === 'object' ? JSON.stringify(v) : (v as Value)
  }
}

const database = (id: string) => {
  let p = dbs.get(id)
  if (!p) dbs.set(id, (p = queryDatabase(id, undefined, ALL_ROWS)))
  return p
}

async function rowsOf(dbId: string): Promise<Record<string, Value>[]> {
  const r = await database(dbId)
  return r.rows.map((row) => {
    const out: Record<string, Value> = { title: row.title }
    for (const p of r.properties) if (p.id !== 'title') out[p.name.toLowerCase()] = cell(p, row.values[p.id], r.related)
    out.created = new Date(row.createdAt).toISOString().slice(0, 10)
    out.updated = new Date(row.updatedAt).toISOString().slice(0, 10)
    return out
  })
}

/** A page's own properties, by lower-case name. */
function pageProps(id: string) {
  let p = props.get(id)
  if (!p) {
    p = withPage(id, (s) => {
      const out: Record<string, Value> = {}
      for (const prop of readProps(s.doc).props) out[prop.name.toLowerCase()] = prop.value as Value
      return out
    }).catch(() => ({}))
    props.set(id, p)
  }
  return p
}

async function valuesOf(id: string): Promise<PageValues> {
  const page = getState().pages[id]
  if (!page) throw new Error('That page is gone')
  const fields: Record<string, Value> = {}
  // A row's cells first, then the page's own properties (which win on the same name).
  if (page.databaseId) {
    const db = await database(page.databaseId).catch(() => null)
    const mine = db?.rows.find((r) => r.id === id)
    if (db && mine) for (const p of db.properties) if (p.id !== 'title') fields[p.name.toLowerCase()] = cell(p, mine.values[p.id], db.related)
  }
  Object.assign(fields, await pageProps(id))
  fields.created ??= new Date(page.createdAt).toISOString().slice(0, 10)
  fields.updated ??= new Date(page.updatedAt).toISOString().slice(0, 10)
  return { title: page.title, fields, ...(page.kind === 'database' ? { rows: await rowsOf(id) } : {}) }
}

/** Find a page as `[[Title]]` names it. */
function byTitle(title: string): string | null {
  const t = title.trim().toLowerCase()
  const live = Object.values(getState().pages).filter((p) => p.trashedAt == null)
  return (live.find((p) => p.title.trim().toLowerCase() === t) ?? null)?.id ?? null
}

export function sourceFor(pageId: string): Source {
  let here: Promise<PageValues> | null = null
  return {
    here: () => (here ??= valuesOf(pageId)),
    page: async (title) => {
      const id = byTitle(title)
      return id ? valuesOf(id) : null
    },
  }
}
