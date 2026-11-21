import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { keyBetween } from '../lib/fractional'
import { uid } from '../lib/id'

/**
 * Properties on any page: a name, a type and a value each, like front matter. Kept in the
 * page's Y.Doc, in the `properties` map: one entry per property (a plain object), plus
 * `$show`, whether they're listed on the page under the title (otherwise only in the pop-up).
 * The core keeps the map with the page but doesn't read it.
 */
export type PagePropType = 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'checkbox' | 'url'

export interface PageProp {
  id: string
  name: string
  type: PagePropType
  order: string
  /** text, url, date (YYYY-MM-DD): string · number · checkbox: boolean · select: string · multiSelect: string[] */
  value: unknown
  /** Choices offered by select and multi-select, in the order they were added. */
  options?: string[]
}

export const PROP_TYPES: [PagePropType, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['select', 'Select'],
  ['multiSelect', 'Multi-select'],
  ['checkbox', 'Checkbox'],
  ['url', 'Link'],
]

const SHOW = '$show'
const mapOf = (doc: Y.Doc) => doc.getMap<unknown>('properties')

export function readProps(doc: Y.Doc): { props: PageProp[]; show: boolean } {
  const m = mapOf(doc)
  const props: PageProp[] = []
  m.forEach((v, k) => {
    if (k !== SHOW && v && typeof v === 'object') props.push(v as PageProp)
  })
  props.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id.localeCompare(b.id)))
  return { props, show: m.get(SHOW) === true }
}

export function usePageProps(doc: Y.Doc | null | undefined) {
  const [state, setState] = useState<{ props: PageProp[]; show: boolean }>({ props: [], show: false })
  useEffect(() => {
    if (!doc) return setState({ props: [], show: false })
    const m = mapOf(doc)
    const update = () => setState(readProps(doc))
    update()
    m.observe(update)
    return () => m.unobserve(update)
  }, [doc])
  return state
}

export function emptyValue(type: PagePropType): unknown {
  return type === 'checkbox' ? false : type === 'multiSelect' ? [] : type === 'number' ? null : ''
}

/** A value carried over to another type as well as it can be. */
function convert(value: unknown, to: PagePropType): unknown {
  const list = Array.isArray(value) ? value.map(String) : value == null || value === '' ? [] : [String(value)]
  switch (to) {
    case 'checkbox':
      return value === true || value === 'true' || value === 'yes'
    case 'number': {
      const n = Number(Array.isArray(value) ? value[0] : value)
      return value === '' || value == null || Number.isNaN(n) ? null : n
    }
    case 'multiSelect':
      return list
    case 'select':
      return list[0] ?? ''
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
    default:
      return typeof value === 'boolean' ? (value ? 'yes' : '') : list.join(', ')
  }
}

export function addProp(doc: Y.Doc, name: string, type: PagePropType): string {
  const { props } = readProps(doc)
  const id = uid()
  const order = keyBetween(props[props.length - 1]?.order ?? null, null)
  mapOf(doc).set(id, { id, name, type, order, value: emptyValue(type), ...(type === 'select' || type === 'multiSelect' ? { options: [] } : {}) })
  return id
}

export function updateProp(doc: Y.Doc, id: string, patch: Partial<Omit<PageProp, 'id'>>) {
  const m = mapOf(doc)
  const cur = m.get(id) as PageProp | undefined
  if (!cur) return
  const next: PageProp = { ...cur, ...patch }
  if (patch.type && patch.type !== cur.type) {
    next.value = convert(cur.value, patch.type)
    if (patch.type === 'select' || patch.type === 'multiSelect') {
      const vals = Array.isArray(next.value) ? next.value : next.value ? [next.value] : []
      next.options = [...new Set([...(cur.options ?? []), ...(vals as string[])])]
    }
  }
  // A value typed into a select becomes one of its choices.
  if ('value' in patch && (next.type === 'select' || next.type === 'multiSelect')) {
    const vals = (Array.isArray(next.value) ? next.value : next.value ? [next.value] : []) as string[]
    next.options = [...new Set([...(next.options ?? []), ...vals])]
  }
  m.set(id, next)
}

export function removeProp(doc: Y.Doc, id: string) {
  mapOf(doc).delete(id)
}

export function moveProp(doc: Y.Doc, id: string, dir: -1 | 1) {
  const { props } = readProps(doc)
  const i = props.findIndex((p) => p.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= props.length) return
  const [a, b] = dir < 0 ? [props[j - 1]?.order ?? null, props[j].order] : [props[j].order, props[j + 1]?.order ?? null]
  updateProp(doc, id, { order: keyBetween(a, b) })
}

export function setShowProps(doc: Y.Doc, show: boolean) {
  mapOf(doc).set(SHOW, show)
}

export const isEmpty = (p: PageProp) =>
  p.value == null || p.value === '' || p.value === false || (Array.isArray(p.value) && p.value.length === 0)

/** Front matter for Markdown export (YAML). Empty properties are left out. */
export function frontMatter(props: PageProp[]): string {
  const filled = props.filter((p) => !isEmpty(p) || p.type === 'checkbox')
  if (!filled.length) return ''
  const str = (s: string) => (/^[\w .,/-]*$/.test(s) && s.trim() === s && s !== '' && !/^(true|false|null|yes|no|\d)/i.test(s) ? s : JSON.stringify(s))
  const key = (s: string) => (/^[\w-]+$/.test(s) ? s : JSON.stringify(s))
  const lines = filled.map((p) => {
    const v = p.value
    if (Array.isArray(v)) return `${key(p.name)}:\n${v.map((x) => `  - ${str(String(x))}`).join('\n')}`
    if (typeof v === 'boolean' || typeof v === 'number') return `${key(p.name)}: ${v}`
    return `${key(p.name)}: ${str(String(v))}`
  })
  return `---\n${lines.join('\n')}\n---\n\n`
}
