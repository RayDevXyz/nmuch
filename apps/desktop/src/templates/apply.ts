import type { JSONContent } from '@tiptap/core'
import type * as Y from 'yjs'
import { createRow, databaseDef, databaseTemplate, queryDatabase, removeView, setProperty, setView } from '../database/api'
import { uid } from '../lib/id'
import type { Page } from '../lib/types'
import { childrenOf, createPage, openPage, withPage } from '../state/actions'
import { getState, toast } from '../state/store'
import { collectVars, render, type Context, type Variable } from './engine'

/**
 * Templates are ordinary pages: the sub-pages of the top-level page called "Templates".
 * Using one copies it (and its sub-pages, header, properties, databases) with every `{{…}}`
 * filled in. See `engine.ts` for the syntax.
 */
export const TEMPLATES_TITLE = 'Templates'

export function templatesFolder(): Page | null {
  return (
    Object.values(getState().pages)
      .filter((p) => p.parentId === null && p.trashedAt == null && p.databaseId == null && p.title.trim().toLowerCase() === TEMPLATES_TITLE.toLowerCase())
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  )
}

export function listTemplates(): Page[] {
  const f = templatesFolder()
  return f ? childrenOf(f.id).filter((p) => !p.archived) : []
}

export async function ensureTemplatesFolder(): Promise<Page> {
  const f = templatesFolder()
  if (f) return f
  const page = await createPage({ title: TEMPLATES_TITLE, icon: '📋', open: false })
  await withPage(page.id, (s) => {
    s.setContent({
      type: 'doc',
      content: [
        p('Each page in here is a template, with its sub-pages. Use one with "New page from template", /template, or by typing {{template: Name}} in a page and pressing Enter.'),
        p('In a template, write \\{{Client}} for something to ask, \\{{Due: date}} for a date, \\{{Status: Todo | Done}} for a choice, \\{{Author = Ray}} for a default, and \\{{title}}, \\{{date}}, \\{{date:dddd D MMMM}}, \\{{time}}, \\{{parent}} for values filled in for you.'),
      ],
    })
    return s.flush()
  })
  return getState().pages[page.id] ?? page
}

const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

// ---------------------------------------------------------------- reading a template

export interface Tree {
  page: Page
  content: JSONContent[]
  header: Record<string, unknown>
  props: Record<string, unknown>
  db: { properties: import('../database/types').Property[]; views: import('../database/types').View[]; rows: { id: string; values: Record<string, unknown> }[] } | null
  children: Tree[]
}

const plain = (m: Y.Map<unknown>) => m.toJSON() as Record<string, unknown>

export async function loadTree(pageId: string, depth = 0): Promise<Tree> {
  const page = getState().pages[pageId]
  if (!page) throw new Error('That template is gone.')
  const { content, header, props } = await withPage(pageId, (s) => ({
    content: s.notesJSON(true).flatMap((n) => n.content ?? []),
    header: plain(s.doc.getMap('header')),
    props: plain(s.doc.getMap('properties')),
  }))
  let db: Tree['db'] = null
  if (page.kind === 'database') {
    const def = await databaseDef(pageId)
    const res = await queryDatabase(pageId, undefined, { id: '', name: '', type: 'table', order: '', filters: [], sorts: [] } as never)
    db = { ...def, rows: res.rows.map((r) => ({ id: r.id, values: r.values })) }
  }
  // Sub-pages (and a database's rows), at most 8 levels down.
  const kids = depth < 8 ? Object.values(getState().pages).filter((c) => c.parentId === pageId && c.trashedAt == null).sort((a, b) => (a.key < b.key ? -1 : 1)) : []
  const children = await Promise.all(kids.map((c) => loadTree(c.id, depth + 1)))
  return { page, content, header, props, db, children }
}

/** Every text of a tree, for finding its variables. */
function* texts(t: Tree): Generator<string> {
  yield t.page.title
  const walk = function* (n: unknown): Generator<string> {
    if (typeof n === 'string') yield n
    else if (Array.isArray(n)) for (const x of n) yield* walk(x)
    else if (n && typeof n === 'object') for (const v of Object.values(n)) yield* walk(v)
  }
  yield* walk(t.content)
  yield* walk(t.header)
  yield* walk(t.props)
  for (const c of t.children) yield* texts(c)
}

/** What the form asks for (the title is asked separately). */
export function variablesOf(t: Tree): Variable[] {
  // The template's own title is the pattern of the new page's title; its other texts' vars count.
  return collectVars(texts(t))
}

// ---------------------------------------------------------------- making pages from it

function renderDeep<T>(v: T, ctx: Context): T {
  if (typeof v === 'string') return render(v, ctx) as T
  if (Array.isArray(v)) return v.map((x) => renderDeep(x, ctx)) as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = k === 'id' ? x : renderDeep(x, ctx)
    return out as T
  }
  return v
}

/** Content with variables filled in and block ids cleared (the editor gives new ones). */
export function renderContent(nodes: JSONContent[], ctx: Context): JSONContent[] {
  const fix = (n: JSONContent): JSONContent | null => {
    if (n.type === 'text') {
      const text = render(n.text ?? '', ctx)
      return text ? { ...n, text } : null
    }
    const attrs = n.attrs ? Object.fromEntries(Object.entries(n.attrs).map(([k, v]) => [k, k === 'id' ? null : typeof v === 'string' ? render(v, ctx) : v])) : undefined
    const content = n.content?.map(fix).filter((x): x is JSONContent => !!x)
    return { ...n, ...(attrs ? { attrs } : {}), ...(n.content ? { content } : {}) }
  }
  return nodes.map(fix).filter((x): x is JSONContent => !!x)
}

async function writePage(id: string, t: Tree, ctx: Context) {
  await withPage(id, (s) => {
    const content = renderContent(t.content, ctx)
    if (content.length) s.setContent({ type: 'doc', content })
    s.doc.transact(() => {
      const header = s.doc.getMap('header')
      for (const [k, v] of Object.entries(t.header)) header.set(k, renderDeep(v, ctx))
      const props = s.doc.getMap('properties')
      for (const [k, v] of Object.entries(t.props)) props.set(k, renderDeep(v, ctx))
    })
    return s.flush()
  })
}

/** Simple column types copy over; relations and rollups point at other databases, so they don't. */
const COPYABLE = new Set(['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url'])

/** `row`: make the page as a row of that database, with these cell values. */
async function makeTree(t: Tree, parentId: string | null, ctx: Context, title: string, row?: { db: string; values: Record<string, unknown> }): Promise<string> {
  let id: string
  if (row) {
    id = uid()
    await createRow(row.db, id, title, renderDeep(row.values, ctx))
  } else {
    const page = await createPage({ parentId, title, icon: t.page.icon, open: false, kind: t.db ? 'database' : 'page' })
    id = page.id
  }
  await writePage(id, t, ctx)
  if (t.db) {
    const fresh = await databaseDef(id)
    for (const prop of t.db.properties) if (prop.id !== 'title' && COPYABLE.has(prop.type)) await setProperty(id, renderDeep(prop, ctx))
    for (const view of t.db.views) await setView(id, view)
    if (t.db.views.length) for (const v of fresh.views) if (!t.db.views.some((x) => x.id === v.id)) await removeView(id, v.id)
  }
  const rowValues = new Map((t.db?.rows ?? []).map((r) => [r.id, r.values]))
  for (const c of t.children) {
    const childCtx = { ...ctx, parent: title }
    const childTitle = render(c.page.title, { ...childCtx, title: c.page.title })
    if (t.db && c.page.databaseId === t.page.id) {
      const values = Object.fromEntries(Object.entries(rowValues.get(c.page.id) ?? {}).filter(([k]) => t.db!.properties.some((p) => p.id === k && COPYABLE.has(p.type))))
      await makeTree(c, id, childCtx, childTitle, { db: id, values })
    } else {
      await makeTree(c, id, childCtx, childTitle)
    }
  }
  return id
}

export interface UseOptions {
  /** The new page's title (already filled in by the form). */
  title: string
  /** Make the page as a new row of this database (`parentId` is then the database). */
  databaseId?: string
  values: Record<string, string>
  /** Where the new page goes (null: top level). */
  parentId: string | null
  open?: boolean
}

export function contextFor(t: Tree, values: Record<string, string>, title: string, parentId: string | null): Context {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]))
  return { values: lower, title, parent: parentId ? getState().pages[parentId]?.title ?? '' : '', template: t.page.title, now: new Date() }
}

/** The new page's title before the user changes it: the template's title, filled in. */
export function defaultTitle(t: Tree, values: Record<string, string>, parentId: string | null): string {
  const ctx = contextFor(t, values, '', parentId)
  return t.page.title.includes('{{') ? render(t.page.title, ctx).trim() : t.page.title
}

/** Make a page (with its sub-pages) from a template. Returns the new page's id. */
export async function createFromTemplate(t: Tree, o: UseOptions): Promise<string> {
  const title = o.title.trim() || (o.databaseId ? rowTitle(t, o.values, o.databaseId) : defaultTitle(t, o.values, o.parentId))
  const ctx = contextFor(t, o.values, title, o.parentId)
  const id = o.databaseId ? await makeTree(t, o.databaseId, ctx, title, { db: o.databaseId, values: {} }) : await makeTree(t, o.parentId, ctx, title)
  if (o.open !== false) {
    // A page made on the server shows up in the app a moment later.
    for (let i = 0; i < 40 && !getState().pages[id]; i++) await new Promise((r) => setTimeout(r, 100))
    openPage(id, 'tab')
  }
  return id
}

/**
 * Use a template inside a page: its content (filled in) to insert where the cursor is; its
 * sub-pages are made under `pageId`.
 */
export async function templateContent(t: Tree, values: Record<string, string>, pageId: string): Promise<JSONContent[]> {
  const page = getState().pages[pageId]
  const ctx = contextFor(t, values, page?.title ?? '', page?.parentId ?? null)
  for (const c of t.children) await makeTree(c, pageId, { ...ctx, parent: page?.title ?? '' }, render(c.page.title, ctx))
  return renderContent(t.content, ctx)
}

/** Save a copy of a page (and its sub-pages) as a template, as is: no variables filled in. */
export async function saveAsTemplate(pageId: string): Promise<string> {
  const folder = await ensureTemplatesFolder()
  const t = await loadTree(pageId)
  // An identity context: render() leaves unknown {{…}} as their defaults, so copy raw instead.
  const raw = async (tree: Tree, parentId: string, rowOf?: string): Promise<string> => {
    let id: string
    if (rowOf) {
      id = uid()
      await createRow(rowOf, id, tree.page.title)
    } else id = (await createPage({ parentId, title: tree.page.title || 'Untitled', icon: tree.page.icon, open: false, kind: tree.db ? 'database' : 'page' })).id
    await withPage(id, (s) => {
      const strip = (ns: JSONContent[]): JSONContent[] => ns.map((n) => ({ ...n, ...(n.attrs ? { attrs: { ...n.attrs, id: null } } : {}), ...(n.content ? { content: strip(n.content) } : {}) }))
      if (tree.content.length) s.setContent({ type: 'doc', content: strip(tree.content) })
      s.doc.transact(() => {
        for (const [k, v] of Object.entries(tree.header)) s.doc.getMap('header').set(k, v)
        for (const [k, v] of Object.entries(tree.props)) s.doc.getMap('properties').set(k, v)
      })
      return s.flush()
    })
    if (tree.db) {
      const fresh = await databaseDef(id)
      for (const prop of tree.db.properties) if (prop.id !== 'title' && COPYABLE.has(prop.type)) await setProperty(id, prop)
      for (const view of tree.db.views) await setView(id, view)
      if (tree.db.views.length) for (const v of fresh.views) if (!tree.db.views.some((x) => x.id === v.id)) await removeView(id, v.id)
    }
    for (const c of tree.children) await raw(c, id, tree.db && c.page.databaseId === tree.page.id ? id : undefined)
    return id
  }
  const id = await raw(t, folder.id)
  toast(`Saved as a template in ${TEMPLATES_TITLE}`)
  return id
}

/** Find a template by name (as typed in `{{template: Name}}`). */
export function findTemplate(name: string): Page | null {
  const n = name.trim().toLowerCase()
  const all = listTemplates()
  return all.find((p) => p.title.trim().toLowerCase() === n) ?? all.find((p) => p.title.toLowerCase().replace(/\{\{[^}]*\}\}/g, '').trim() === n) ?? all.find((p) => p.title.toLowerCase().startsWith(n)) ?? null
}

// ---------------------------------------------------------------- templates for database rows

/** A row's title from a template: its title only when it has fields (`Meeting {{date}}`), else empty. */
export function rowTitle(t: Tree, values: Record<string, string>, databaseId: string): string {
  return t.page.title.includes('{{') ? defaultTitle(t, values, databaseId) : ''
}

/** Whether a template page is still there (not deleted or trashed). */
export function templateExists(id: string | null | undefined): id is string {
  const p = id ? getState().pages[id] : undefined
  return !!p && p.trashedAt == null
}

const hasText = (ns: JSONContent[]): boolean =>
  ns.some((n) => (n.type === 'text' ? !!n.text?.trim() : !['paragraph', 'heading'].includes(n.type ?? '') || hasText(n.content ?? [])))

/**
 * Fill an existing page from a template: its content, header and properties (and its sub-pages,
 * made under the page). `append` adds the content below what is there; otherwise a page that
 * already has text keeps it and gets nothing.
 */
export async function fillFromTemplate(pageId: string, templateId: string, o: { append?: boolean; values?: Record<string, string> } = {}): Promise<void> {
  if (!templateExists(templateId)) return
  for (let i = 0; i < 30 && !getState().pages[pageId]; i++) await new Promise((r) => setTimeout(r, 100))
  const tree = await loadTree(templateId)
  const page = getState().pages[pageId]
  const ctx = contextFor(tree, o.values ?? {}, page?.title ?? '', page?.parentId ?? null)
  const has = await withPage(pageId, (s) => hasText(s.notesJSON(true).flatMap((n) => n.content ?? [])))
  if (has && !o.append) return
  const content = await templateContent(tree, o.values ?? {}, pageId)
  await withPage(pageId, (s) => {
    const existing = s.notesJSON(true).flatMap((n) => n.content ?? [])
    if (content.length) s.setContent({ type: 'doc', content: has ? [...existing, ...content] : content })
    s.doc.transact(() => {
      const header = s.doc.getMap('header')
      for (const [k, v] of Object.entries(tree.header)) if (!header.has(k)) header.set(k, renderDeep(v, ctx))
      const props = s.doc.getMap('properties')
      for (const [k, v] of Object.entries(tree.props)) if (!props.has(k)) props.set(k, renderDeep(v, ctx))
    })
    return s.flush()
  })
}

/**
 * A row was just made in a database: give it the database's template (or `templateId`), if
 * one is set. Fields in the template take their defaults; nothing is asked.
 */
export async function applyDatabaseTemplate(databaseId: string, rowId: string, templateId?: string | null, append = false): Promise<void> {
  const id = templateId === undefined ? await databaseTemplate(databaseId).catch(() => null) : templateId
  if (templateExists(id)) await fillFromTemplate(rowId, id, { append })
}
