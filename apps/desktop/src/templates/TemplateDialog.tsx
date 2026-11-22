import type { JSONContent } from '@tiptap/core'
import { FileStack, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { openPage } from '../state/actions'
import { setState, toast, useApp } from '../state/store'
import { defaultTitle, ensureTemplatesFolder, listTemplates, loadTree, templateContent, createFromTemplate, variablesOf, type Tree } from './apply'
import type { Variable } from './engine'

/** What the template form does with its result. */
export interface TemplateRequest {
  /** Where a new page goes (null: top level). */
  parentId: string | null
  /** Start on this template (skip the list). */
  templateId?: string
  /** Values given already (from `{{template: … | Name: value}}`), keys lower-case. */
  values?: Record<string, string>
  /** Opened from a page's editor: offer "insert here" as well as a new sub-page. */
  fromEditor?: boolean
  onDone?: (r: { pageId: string } | { content: JSONContent[] }) => void
  onCancel?: () => void
}

export const openTemplateDialog = (req: TemplateRequest) => setState({ templateDialog: req })

/** True when every variable has a value or a default: the form can be skipped. */
export function filledIn(vars: Variable[], values: Record<string, string>) {
  return vars.every((v) => (values[v.name.toLowerCase()] ?? '').trim() || v.default)
}

export function TemplateDialog() {
  const req = useApp((s) => s.templateDialog)
  return req ? <Dialog key={req.templateId ?? 'list'} req={req} /> : null
}

function Dialog({ req }: { req: TemplateRequest }) {
  const pages = useApp((s) => s.pages)
  const templates = useMemo(() => listTemplates(), [pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const [chosen, setChosen] = useState<string | null>(req.templateId ?? null)
  const [tree, setTree] = useState<Tree | null>(null)
  const [q, setQ] = useState('')
  const [values, setValues] = useState<Record<string, string>>(req.values ?? {})
  const [title, setTitle] = useState<string | null>(req.values?.title ?? null)
  const [mode, setMode] = useState<'page' | 'insert'>('page')
  const [busy, setBusy] = useState(false)
  const close = (cancelled = true) => {
    if (busy) return
    if (cancelled) req.onCancel?.()
    setState({ templateDialog: null })
  }

  useEffect(() => {
    if (!chosen) return setTree(null)
    let live = true
    loadTree(chosen).then(
      (t) => live && setTree(t),
      (e) => {
        toast(String(e).replace(/^Error:\s*/, ''))
        setChosen(null)
      },
    )
    return () => {
      live = false
    }
  }, [chosen])

  const vars = useMemo(() => (tree ? variablesOf(tree) : []), [tree])
  const val = (name: string) => values[name.toLowerCase()] ?? ''
  const setVal = (name: string, v: string) => setValues((s) => ({ ...s, [name.toLowerCase()]: v }))
  const shown = templates.filter((t) => t.title.toLowerCase().includes(q.trim().toLowerCase()))

  const create = async () => {
    if (!tree) return
    setBusy(true)
    try {
      const filled = Object.fromEntries(vars.map((v) => [v.name.toLowerCase(), val(v.name) || v.default]))
      if (mode === 'insert' && req.fromEditor && req.parentId) {
        const content = await templateContent(tree, filled, req.parentId)
        req.onDone?.({ content })
      } else {
        const pageId = await createFromTemplate(tree, { title: title ?? '', values: filled, parentId: req.parentId, open: !req.onDone })
        req.onDone?.({ pageId })
      }
      setState({ templateDialog: null })
    } catch (e) {
      toast(`Could not use the template: ${String(e).replace(/^Error:\s*/, '')}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="account tpl-dialog" role="dialog" aria-label="Use a template" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header>
          <span>
            <FileStack size={16} /> {tree ? tree.page.icon ? `${tree.page.icon} ${tree.page.title}` : tree.page.title : 'Use a template'}
          </span>
          <button className="icon-button" aria-label="Close" onClick={() => close()}>
            <X size={16} />
          </button>
        </header>
        {!chosen ? (
          <section>
            {templates.length === 0 ? (
              <>
                <p className="account-hint">
                  No templates yet. A template is any page inside the top-level page <b>Templates</b>, with its sub-pages. You can also open a page's ⋯ menu and choose <b>Save as template</b>.
                </p>
                <button
                  className="setting-action primary"
                  onClick={async () => {
                    const f = await ensureTemplatesFolder()
                    close()
                    openPage(f.id, 'tab')
                  }}
                >
                  Make the Templates page
                </button>
              </>
            ) : (
              <>
                <label className="tpl-search">
                  <Search size={14} />
                  <input autoFocus placeholder="Find a template…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && shown[0] && setChosen(shown[0].id)} />
                </label>
                <ul className="tpl-list">
                  {shown.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => setChosen(t.id)}>
                        <span className="tpl-icon">{t.icon || '📄'}</span>
                        <span className="tpl-name">{t.title || 'Untitled'}</span>
                        {Object.values(pages).some((c) => c.parentId === t.id && c.trashedAt == null) && <small>with sub-pages</small>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : !tree ? (
          <section>
            <p className="account-hint">Reading the template…</p>
          </section>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <section>
              {req.fromEditor && (
                <div className="sync-modes tpl-modes" role="radiogroup">
                  <label className={mode === 'page' ? 'on' : ''}>
                    <input type="radio" checked={mode === 'page'} onChange={() => setMode('page')} />
                    <span>
                      <b>As a sub-page</b>
                      <small>A new page under this one, linked where the cursor is.</small>
                    </span>
                  </label>
                  <label className={mode === 'insert' ? 'on' : ''}>
                    <input type="radio" checked={mode === 'insert'} onChange={() => setMode('insert')} />
                    <span>
                      <b>Insert here</b>
                      <small>The template's content goes into this page{tree.children.length ? '; its sub-pages are made under this page' : ''}.</small>
                    </span>
                  </label>
                </div>
              )}
              {mode === 'page' && (
                <label className="sync-field">
                  <span>Title</span>
                  <input autoFocus value={title ?? defaultTitle(tree, values, req.parentId)} onChange={(e) => setTitle(e.target.value)} />
                </label>
              )}
              {vars.map((v, i) => (
                <label key={v.name} className="sync-field">
                  <span>{v.name}</span>
                  {v.kind === 'choice' ? (
                    <select value={val(v.name) || v.default} onChange={(e) => setVal(v.name, e.target.value)}>
                      {!v.default && <option value="">—</option>}
                      {v.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      autoFocus={mode === 'insert' && i === 0}
                      type={v.kind === 'date' ? 'date' : v.kind === 'number' ? 'number' : 'text'}
                      placeholder={v.default}
                      value={val(v.name)}
                      onChange={(e) => setVal(v.name, e.target.value)}
                    />
                  )}
                </label>
              ))}
              {vars.length === 0 && <p className="account-hint">This template asks for nothing{mode === 'page' ? ' but a title' : ''}.</p>}
              {tree.children.length > 0 && (
                <p className="account-hint">
                  Also makes {count(tree.children)} sub-page{count(tree.children) === 1 ? '' : 's'}.
                </p>
              )}
              <div className="sync-actions">
                {!req.templateId && (
                  <button type="button" className="setting-action" onClick={() => setChosen(null)}>
                    Back
                  </button>
                )}
                <button type="submit" className="setting-action primary" disabled={busy}>
                  {busy ? 'Making…' : mode === 'insert' ? 'Insert' : 'Create page'}
                </button>
              </div>
            </section>
          </form>
        )}
      </div>
    </div>
  )
}

const count = (ts: Tree[]): number => ts.reduce((n, t) => n + 1 + count(t.children), 0)
