import { Check, Link2, NotebookText, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getState, toast } from '../state/store'
import { collections, saveToBurrow, useBurrow, useBurrowData } from './api'
import { ConnectBurrow } from './Burrow'

/**
 * Save to Burrow (a page's ⋯ menu, `/save to burrow`): the page as a note, or the web links in
 * it as bookmarks, with tags (the page's #tags to start with) and a collection.
 */

let request: { pageId: string } | null = null
const subs = new Set<() => void>()
const set = (r: typeof request) => ((request = r), subs.forEach((l) => l()))
export const openSaveToBurrow = (pageId: string) => set({ pageId })

/** Web links in Markdown: [text](https://…) and bare https://… addresses. */
export function linksIn(md: string): { url: string; title: string }[] {
  const out = new Map<string, string>()
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g)) out.set(m[2], m[1] || m[2])
  for (const m of md.matchAll(/(?<![(\w])(https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"])/g)) if (!out.has(m[1])) out.set(m[1], m[1])
  return [...out].map(([url, title]) => ({ url, title }))
}
/** The #tags written in a page. */
export const tagsIn = (md: string) => [...new Set([...md.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)].map((m) => m[1]))]

export function SaveToBurrowHost() {
  const r = useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => request)
  return r ? createPortal(<SaveDialog pageId={r.pageId} close={() => set(null)} />, document.body) : null
}

function SaveDialog({ pageId, close }: { pageId: string; close: () => void }) {
  const conn = useBurrow()
  const page = getState().pages[pageId]
  const [md, setMd] = useState<string | null>(null)
  const [mode, setMode] = useState<'note' | 'links'>('note')
  const [tags, setTags] = useState('')
  const [coll, setColl] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const cols = useBurrowData(conn ? collections : null, [conn?.url])
  useEffect(() => {
    void import('../editor/Editor').then(({ pageMarkdown }) =>
      pageMarkdown(pageId).then((m) => {
        setMd(m)
        setTags(tagsIn(m).join(' '))
        const links = linksIn(m)
        setPicked(new Set(links.map((l) => l.url)))
        if (links.length && !m.replace(/\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|^#.*$/gm, '').trim()) setMode('links')
      }),
    )
  }, [pageId])
  const links = md ? linksIn(md) : []
  const tagList = tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean)
  const save = async () => {
    setBusy(true)
    const collectionId = coll ? Number(coll) : null
    try {
      if (mode === 'note') {
        const r = await saveToBurrow({ note: md ?? '', title: page?.title || 'Untitled', tags: [...tagList, 'brainwaves'], collectionId })
        toast(r.duplicate ? 'Already in Burrow' : 'Saved to Burrow as a note')
      } else {
        let added = 0
        let had = 0
        for (const l of links.filter((l) => picked.has(l.url))) {
          const r = await saveToBurrow({ url: l.url, title: l.title !== l.url ? l.title : undefined, tags: tagList, collectionId })
          if (r.duplicate) had++
          else added++
        }
        toast(`Saved ${added} link${added === 1 ? '' : 's'} to Burrow${had ? ` (${had} already there)` : ''}`)
      }
      close()
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="bw-save" role="dialog" aria-label="Save to Burrow">
        <header>
          <span>🦫 Save to Burrow</span>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={15} />
          </button>
        </header>
        {!conn ? (
          <ConnectBurrow compact />
        ) : (
          <div className="bw-save-body">
            <div className="bw-modes">
              <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>
                <NotebookText size={14} /> This page as a note
              </button>
              <button className={mode === 'links' ? 'on' : ''} onClick={() => setMode('links')} disabled={!links.length}>
                <Link2 size={14} /> Its links ({links.length})
              </button>
            </div>
            {mode === 'note' ? (
              <p className="bw-hint">
                “{page?.title || 'Untitled'}” goes to Burrow as a note, in Markdown{md ? ` (${md.length.toLocaleString()} characters)` : ''}. Burrow finds the #tags in it too.
              </p>
            ) : (
              <ul className="bw-links">
                {links.map((l) => (
                  <li key={l.url}>
                    <label>
                      <input type="checkbox" checked={picked.has(l.url)} onChange={(e) => setPicked((s) => (e.target.checked ? new Set([...s, l.url]) : new Set([...s].filter((x) => x !== l.url))))} />
                      <span>
                        <b>{l.title}</b>
                        {l.title !== l.url && <small>{l.url}</small>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <label className="bw-field">
              Tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="reading research/ai" />
            </label>
            {!!cols.data?.length && (
              <label className="bw-field">
                Collection
                <select value={coll} onChange={(e) => setColl(e.target.value)}>
                  <option value="">Unsorted</option>
                  {cols.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ''}
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="bw-save-actions">
              <button className="bw-btn" onClick={close}>
                Cancel
              </button>
              <button className="bw-btn primary" disabled={busy || md === null || (mode === 'links' && picked.size === 0)} onClick={() => void save()}>
                <Check size={13} /> {busy ? 'Saving…' : mode === 'note' ? 'Save the page' : `Save ${picked.size} link${picked.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
