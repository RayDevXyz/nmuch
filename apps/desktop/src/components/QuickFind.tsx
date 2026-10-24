import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, FilePlus2, FileText, Search } from 'lucide-react'
import { createPage, openPage } from '../state/actions'
import { getState, setState, useApp } from '../state/store'
import { db } from '../lib/storage'
import type { Hit, Page } from '../lib/types'
import { relativeTime } from '../lib/time'

type Row = { kind: 'page'; page: Page; snippet?: string; blockId?: string } | { kind: 'create'; title: string }

function snippetAround(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text.slice(0, 120)
  const start = Math.max(0, i - 40)
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 80)
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export function QuickFind() {
  const pages = useApp((s) => s.pages)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const query = q.trim()
    if (!query) return setHits([])
    const t = setTimeout(() => db().search(query, 25).then(setHits), 90)
    return () => clearTimeout(t)
  }, [q])

  const rows: Row[] = useMemo(() => {
    const query = q.trim()
    const live = (id: string) => pages[id] && pages[id].trashedAt == null
    if (!query) {
      return Object.values(pages)
        .filter((p) => p.trashedAt == null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8)
        .map((page): Row => ({ kind: 'page', page }))
    }
    const out: Row[] = []
    const seen = new Set<string>()
    hits
      .filter((h) => !h.blockId && live(h.pageId))
      .forEach((h) => {
        seen.add(h.pageId)
        out.push({ kind: 'page', page: pages[h.pageId] })
      })
    hits
      .filter((h) => h.blockId && live(h.pageId))
      .forEach((h) => {
        if (seen.has(h.pageId + h.blockId)) return
        seen.add(h.pageId + h.blockId)
        out.push({ kind: 'page', page: pages[h.pageId], snippet: snippetAround(h.text, query), blockId: h.blockId ?? undefined })
      })
    if (!Object.values(pages).some((p) => p.trashedAt == null && p.title.toLowerCase() === query.toLowerCase())) out.push({ kind: 'create', title: query })
    return out.slice(0, 30)
  }, [q, hits, pages])

  useEffect(() => setIndex(0), [q])

  const close = () => setState({ quickFind: false })
  const choose = (row: Row | undefined, newTab: boolean) => {
    if (!row) return
    close()
    if (row.kind === 'create') createPage({ title: row.title, open: newTab ? 'tab' : 'replace' })
    else openPage(row.page.id, newTab ? 'tab' : 'replace', row.blockId)
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="quickfind" role="dialog" aria-label="Quick find">
        <div className="qf-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search pages and content…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(rows.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(rows[index], e.ctrlKey || e.metaKey)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="qf-caption">{q.trim() ? 'Results' : 'Recent pages'}</div>
        <div className="qf-list">
          {rows.map((row, i) => (
            <button key={i} className={`qf-row ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={(e) => choose(row, e.ctrlKey || e.metaKey)}>
              {row.kind === 'create' ? (
                <>
                  <span className="qf-icon">
                    <FilePlus2 size={15} />
                  </span>
                  <span className="qf-main">
                    <strong>Create “{row.title}”</strong>
                  </span>
                </>
              ) : (
                <>
                  <span className="qf-icon">{row.page.icon || <FileText size={15} />}</span>
                  <span className="qf-main">
                    <strong>
                      <Highlight text={row.page.title || 'Untitled'} q={q.trim()} />
                    </strong>
                    {row.snippet && (
                      <small>
                        <Highlight text={row.snippet} q={q.trim()} />
                      </small>
                    )}
                  </span>
                  <span className="qf-meta">{relativeTime(row.page.updatedAt)}</span>
                </>
              )}
              {i === index && <CornerDownLeft size={13} className="qf-enter" />}
            </button>
          ))}
          {!rows.length && <div className="panel-empty">Nothing found</div>}
        </div>
        <div className="qf-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Ctrl</kbd>
            <kbd>Enter</kbd> new tab
          </span>
        </div>
      </div>
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}

export const openQuickFind = () => setState({ quickFind: !getState().quickFind })
