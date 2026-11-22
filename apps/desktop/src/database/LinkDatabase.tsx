import { Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { uid } from '../lib/id'
import type { Page } from '../lib/types'
import { ancestors } from '../state/actions'
import { useApp } from '../state/store'
import { databaseDef, setView } from './api'
import { VIEW_ICON } from './DatabaseView'
import type { View } from './types'

/**
 * "Linked database": show an existing database (any of its views, or a new view just for this
 * page) on another page. The block only points at the database; rows stay where they are, so an
 * edit in either place shows in both.
 */
interface Pending {
  pageId: string
  resolve: (r: { databaseId: string; viewId: string } | null) => void
}
let open: ((p: Pending | null) => void) | null = null

export function pickDatabaseView(pageId: string): Promise<{ databaseId: string; viewId: string } | null> {
  return new Promise((resolve) => (open ? open({ pageId, resolve }) : resolve(null)))
}

/** A new view of `databaseId` for one page: a copy of `from` (filters, sorts, grouping). */
export async function viewForPage(databaseId: string, from: View, pageTitle: string): Promise<string> {
  const id = uid()
  await setView(databaseId, { ...from, id, name: pageTitle ? `${pageTitle}` : `${from.name} (linked)`, order: `z${Date.now().toString(36)}` })
  return id
}

export function LinkDatabaseDialog() {
  const [p, setP] = useState<Pending | null>(null)
  open = setP
  if (!p) return null
  return <Dialog p={p} close={(r) => (p.resolve(r), setP(null))} />
}

function Dialog({ p, close }: { p: Pending; close: (r: { databaseId: string; viewId: string } | null) => void }) {
  const pages = useApp((s) => s.pages)
  const [q, setQ] = useState('')
  const [db, setDb] = useState<Page | null>(null)
  const [views, setViews] = useState<View[] | null>(null)
  const [busy, setBusy] = useState(false)
  const databases = useMemo(
    () =>
      Object.values(pages)
        .filter((x) => x.kind === 'database' && x.trashedAt == null && !x.archived)
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [pages],
  )
  const shown = databases.filter((d) => (d.title || 'untitled database').toLowerCase().includes(q.trim().toLowerCase()))
  useEffect(() => {
    if (!db) return setViews(null)
    let live = true
    databaseDef(db.id).then((d) => live && setViews(d.views), () => live && setViews([]))
    return () => {
      live = false
    }
  }, [db])
  const where = (d: Page) =>
    ancestors(d.id)
      .filter((a) => a.id !== d.id)
      .map((a) => a.title || 'Untitled')
      .join(' / ')

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <div className="account tpl-dialog" role="dialog" aria-label="Linked database" onKeyDown={(e) => e.key === 'Escape' && close(null)}>
        <header>
          <span>{db ? `${db.icon || '🗂️'} ${db.title || 'Untitled database'}` : 'Show a database here'}</span>
          <button className="icon-button" aria-label="Close" onClick={() => close(null)}>
            <X size={16} />
          </button>
        </header>
        <section>
          {!db ? (
            databases.length === 0 ? (
              <p className="account-hint">There are no databases yet. Make one with /database.</p>
            ) : (
              <>
                <p className="account-hint">The rows stay in the database: edits here show there too, and the other way round.</p>
                <label className="tpl-search">
                  <Search size={14} />
                  <input autoFocus placeholder="Find a database…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && shown[0] && setDb(shown[0])} />
                </label>
                <ul className="tpl-list">
                  {shown.map((d) => (
                    <li key={d.id}>
                      <button onClick={() => setDb(d)}>
                        <span className="tpl-icon">{d.icon || '🗂️'}</span>
                        <span className="tpl-name">{d.title || 'Untitled database'}</span>
                        {where(d) && <small>{where(d)}</small>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : !views ? (
            <p className="account-hint">Reading its views…</p>
          ) : (
            <>
              <p className="account-hint">Which view? A view of its own lets this page filter and sort the rows without changing the database's other views.</p>
              <ul className="tpl-list">
                {views[0] && (
                  <li>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        const viewId = await viewForPage(db.id, views[0], pages[p.pageId]?.title ?? '')
                        close({ databaseId: db.id, viewId })
                      }}
                    >
                      <span className="tpl-icon">
                        <Plus size={14} />
                      </span>
                      <span className="tpl-name">A new view just for this page</span>
                      <small>a copy of {views[0].name}</small>
                    </button>
                  </li>
                )}
                {views.map((v) => {
                  const Icon = VIEW_ICON[v.type]
                  return (
                    <li key={v.id}>
                      <button onClick={() => close({ databaseId: db.id, viewId: v.id })}>
                        <span className="tpl-icon">
                          <Icon size={14} />
                        </span>
                        <span className="tpl-name">{v.name}</span>
                        <small>shared view</small>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="sync-actions">
                <button className="setting-action" onClick={() => setDb(null)}>
                  Back
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
