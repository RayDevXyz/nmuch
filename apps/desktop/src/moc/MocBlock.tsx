import type { MocBlockProps } from '@brainwaves/editor'
import { ChevronRight, FileText, Map as MapIcon, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/storage'
import type { Page, TagCount } from '../lib/types'
import { openPage } from '../state/actions'
import { getState, useApp } from '../state/store'

/**
 * A map of content (MOC): a live index of pages. It stores only its settings and works the
 * list out from the workspace every time, so a new, renamed, moved or tagged page shows up
 * (or drops out) on its own.
 */
export interface MocSettings {
  /** Which pages: this page's sub-pages, pages with a tag, a database's rows, or all pages. */
  source: 'children' | 'tag' | 'database' | 'all'
  tag?: string
  databaseId?: string
  /** For sub-pages and all pages: how many levels down to list (1–3). */
  depth?: number
  sort?: 'manual' | 'title' | 'updated' | 'created'
  groupBy?: 'none' | 'letter' | 'parent'
  style?: 'list' | 'cards' | 'columns'
  title?: string
}

const SOURCES: [MocSettings['source'], string][] = [
  ['children', 'Sub-pages of this page'],
  ['tag', 'Pages with a tag'],
  ['database', 'Rows of a database'],
  ['all', 'All pages'],
]

const visible = (p: Page) => p.trashedAt == null && !p.archived

interface Item {
  page: Page
  kids: Item[]
}

function sorter(sort: MocSettings['sort']) {
  return (a: Page, b: Page) => {
    switch (sort) {
      case 'title':
        return (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { sensitivity: 'base', numeric: true })
      case 'updated':
        return b.updatedAt - a.updatedAt
      case 'created':
        return b.createdAt - a.createdAt
      default:
        return a.key < b.key ? -1 : a.key > b.key ? 1 : a.id.localeCompare(b.id)
    }
  }
}

/** The pages a MOC lists, as a tree (depth > 1 nests sub-pages under their parent). */
export function mocItems(s: MocSettings, pageId: string, pages: Record<string, Page>, tagged: string[] | null): Item[] {
  const all = Object.values(pages).filter(visible)
  const byParent = new Map<string, Page[]>()
  for (const p of all) if (p.parentId) byParent.set(p.parentId, [...(byParent.get(p.parentId) ?? []), p])
  const cmp = sorter(s.sort)
  const depth = Math.max(1, Math.min(3, s.depth ?? 1))
  const tree = (parent: string, level: number): Item[] =>
    (byParent.get(parent) ?? [])
      .filter((p) => p.id !== pageId)
      .sort(cmp)
      .map((page) => ({ page, kids: level < depth ? tree(page.id, level + 1) : [] }))
  const flat = (list: Page[]) => list.filter((p) => p.id !== pageId).sort(cmp).map((page) => ({ page, kids: [] }))
  switch (s.source) {
    case 'children':
      return tree(pageId, 1)
    case 'tag':
      return tagged ? flat(tagged.map((id) => pages[id]).filter((p): p is Page => !!p && visible(p))) : []
    case 'database':
      return s.databaseId ? flat(all.filter((p) => p.databaseId === s.databaseId)) : []
    case 'all':
      return depth > 1
        ? all.filter((p) => !p.parentId || !pages[p.parentId] || !visible(pages[p.parentId])).filter((p) => p.id !== pageId).sort(cmp).map((page) => ({ page, kids: tree(page.id, 2) }))
        : flat(all.filter((p) => !p.databaseId))
  }
}

function groups(items: Item[], by: MocSettings['groupBy'], pages: Record<string, Page>): [string, Item[]][] {
  if (!by || by === 'none') return [['', items]]
  const out = new Map<string, Item[]>()
  for (const it of items) {
    const key =
      by === 'letter'
        ? ((it.page.title || 'Untitled').trim()[0] ?? '#').toLocaleUpperCase().replace(/[^\p{L}]/u, '#')
        : it.page.parentId && pages[it.page.parentId]
          ? pages[it.page.parentId].title || 'Untitled'
          : 'Top level'
    out.set(key, [...(out.get(key) ?? []), it])
  }
  return [...out.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
}

/**
 * For Markdown export: each map of content becomes a bulleted list of page links, as it looks
 * right now.
 */
export async function expandMocs<T extends { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }>(doc: T, pageId: string): Promise<T> {
  const pages = getState().pages
  const walk = async (n: T): Promise<T> => {
    if (n.type === 'moc') {
      let s: MocSettings
      try {
        s = { source: 'children', ...JSON.parse(String(n.attrs?.settings ?? '{}')) }
      } catch {
        s = { source: 'children' }
      }
      const tagged = s.source === 'tag' && s.tag ? await db().pagesWithTag(s.tag).catch(() => []) : null
      const toList = (items: Item[]): unknown => ({
        type: 'bulletList',
        content: items.map((it) => ({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'ref', attrs: { kind: 'page', target: it.page.id } }] },
            ...(it.kids.length ? [toList(it.kids)] : []),
          ],
        })),
      })
      const items = mocItems(s, pageId, pages, tagged)
      return (items.length ? toList(items) : { type: 'paragraph' }) as T
    }
    return n.content ? { ...n, content: await Promise.all((n.content as T[]).map(walk)) } : n
  }
  return walk(doc)
}

const count = (items: Item[]): number => items.reduce((n, i) => n + 1 + count(i.kids), 0)

export function MocBlock({ settings, editable, onSettings, pageId }: MocBlockProps & { pageId: string }) {
  const s = { source: 'children', ...settings } as MocSettings
  const pages = useApp((st) => st.pages)
  const indexVersion = useApp((st) => st.indexVersion)
  const [tagged, setTagged] = useState<string[] | null>(null)
  const [editing, setEditing] = useState(false)

  // Tags live in the text, so ask the index; it re-reads whenever the index changes.
  useEffect(() => {
    if (s.source !== 'tag' || !s.tag) return setTagged(null)
    let live = true
    db()
      .pagesWithTag(s.tag.replace(/^#/, ''))
      .then((ids) => live && setTagged(ids))
      .catch(() => live && setTagged([]))
    return () => {
      live = false
    }
  }, [s.source, s.tag, indexVersion])

  const items = useMemo(() => mocItems(s, pageId, pages, tagged), [JSON.stringify(s), pageId, pages, tagged]) // eslint-disable-line react-hooks/exhaustive-deps
  const grouped = useMemo(() => groups(items, s.groupBy, pages), [items, s.groupBy, pages])
  const n = count(items)
  const set = (patch: Partial<MocSettings>) => onSettings({ ...s, ...patch })

  const heading =
    s.title ||
    (s.source === 'children'
      ? 'Contents'
      : s.source === 'tag'
        ? s.tag ? `#${s.tag.replace(/^#/, '')}` : 'Pages with a tag'
        : s.source === 'database'
          ? (s.databaseId && pages[s.databaseId]?.title) || 'Database'
          : 'All pages')

  const open = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    openPage(id, e.ctrlKey || e.metaKey || e.button === 1 ? 'tab' : 'replace')
  }
  const link = (p: Page) => (
    <a href={`#${p.id}`} className="moc-link" onClick={(e) => open(e, p.id)} onAuxClick={(e) => open(e, p.id)}>
      <span className="moc-icon">{p.icon || <FileText size={13} />}</span>
      <span className="moc-title">{p.title || 'Untitled'}</span>
    </a>
  )
  const list = (its: Item[]): React.ReactNode => (
    <ul className="moc-list">
      {its.map((it) => (
        <li key={it.page.id}>
          {link(it.page)}
          {it.kids.length > 0 && list(it.kids)}
        </li>
      ))}
    </ul>
  )
  const body = (its: Item[]) =>
    s.style === 'cards' ? (
      <div className="moc-cards">
        {its.map((it) => (
          <a key={it.page.id} href={`#${it.page.id}`} className="moc-card" onClick={(e) => open(e, it.page.id)} onAuxClick={(e) => open(e, it.page.id)}>
            <span className="moc-card-icon">{it.page.icon || <FileText size={18} />}</span>
            <b>{it.page.title || 'Untitled'}</b>
            {it.kids.length > 0 && <small>{count(it.kids)} inside</small>}
          </a>
        ))}
      </div>
    ) : (
      <div className={s.style === 'columns' ? 'moc-columns' : ''}>{list(its)}</div>
    )

  return (
    <div className="moc">
      <div className="moc-head">
        <MapIcon size={14} className="moc-head-icon" />
        <b>{heading}</b>
        <span className="moc-count">{n}</span>
        {editable && (
          <button className={`moc-gear ${editing ? 'on' : ''}`} title="Map of content settings" aria-label="Map of content settings" onClick={() => setEditing((v) => !v)}>
            <Settings2 size={14} />
          </button>
        )}
      </div>
      {editing && <MocSettingsPanel s={s} set={set} pages={pages} />}
      {n === 0 ? (
        <div className="moc-empty">
          {s.source === 'children'
            ? 'No sub-pages yet. Pages you nest under this one appear here.'
            : s.source === 'tag'
              ? s.tag ? `No pages with #${s.tag.replace(/^#/, '')} yet.` : 'Pick a tag in the settings.'
              : s.source === 'database'
                ? s.databaseId ? 'This database has no rows yet.' : 'Pick a database in the settings.'
                : 'No pages yet.'}
        </div>
      ) : (
        grouped.map(([g, its]) => (
          <div key={g || '_'} className="moc-group">
            {g && (
              <div className="moc-group-label">
                <ChevronRight size={12} /> {g}
              </div>
            )}
            {body(its)}
          </div>
        ))
      )}
    </div>
  )
}

function MocSettingsPanel({ s, set, pages }: { s: MocSettings; set: (p: Partial<MocSettings>) => void; pages: Record<string, Page> }) {
  const [tags, setTags] = useState<TagCount[]>([])
  useEffect(() => {
    db().tags().then(setTags).catch(() => {})
  }, [])
  const databases = Object.values(pages)
    .filter((p) => p.kind === 'database' && visible(p))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  const seg = <T extends string>(value: T | undefined, fallback: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="moc-seg">
      {opts.map(([v, label]) => (
        <button key={v} className={(value ?? fallback) === v ? 'on' : ''} onClick={() => on(v)}>
          {label}
        </button>
      ))}
    </div>
  )
  return (
    <div className="moc-settings">
      <label>
        <span>Show</span>
        <select value={s.source} onChange={(e) => set({ source: e.target.value as MocSettings['source'] })}>
          {SOURCES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {s.source === 'tag' && (
        <label>
          <span>Tag</span>
          <input list="moc-tags" placeholder="#tag" value={s.tag ?? ''} onChange={(e) => set({ tag: e.target.value.replace(/^#/, '').trim() })} />
          <datalist id="moc-tags">
            {tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                {`${t.tag} (${t.count})`}
              </option>
            ))}
          </datalist>
        </label>
      )}
      {s.source === 'database' && (
        <label>
          <span>Database</span>
          <select value={s.databaseId ?? ''} onChange={(e) => set({ databaseId: e.target.value })}>
            <option value="">Choose…</option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.icon ? `${d.icon} ` : ''}
                {d.title || 'Untitled'}
              </option>
            ))}
          </select>
        </label>
      )}
      {(s.source === 'children' || s.source === 'all') && (
        <label>
          <span>Levels</span>
          {seg(String(s.depth ?? 1) as '1' | '2' | '3', '1', [['1', '1'], ['2', '2'], ['3', '3']], (v) => set({ depth: Number(v) }))}
        </label>
      )}
      <label>
        <span>Sort</span>
        {seg(s.sort, 'manual', [['manual', 'As in sidebar'], ['title', 'A–Z'], ['updated', 'Updated'], ['created', 'Created']], (v) => set({ sort: v }))}
      </label>
      <label>
        <span>Group</span>
        {seg(s.groupBy, 'none', [['none', 'None'], ['letter', 'First letter'], ['parent', 'Parent page']], (v) => set({ groupBy: v }))}
      </label>
      <label>
        <span>Style</span>
        {seg(s.style, 'list', [['list', 'List'], ['columns', 'Columns'], ['cards', 'Cards']], (v) => set({ style: v }))}
      </label>
      <label>
        <span>Title</span>
        <input placeholder="Automatic" value={s.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
      </label>
    </div>
  )
}
