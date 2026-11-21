import type { JSONContent } from '@tiptap/core'
import { Inbox, FilePlus2, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPage, openPage, withPage } from '../state/actions'
import { getState, toast } from '../state/store'
import { cardContent, saveToBurrow, useBurrow } from '../burrow/api'

/**
 * Sharing into BrainWaves from Android's share menu (the manifest's `share_target` opens
 * `/share?title=&text=&url=`). The shared link and text go into the Inbox page, or a new page
 * under it, and to Burrow too if you like. Shared while offline: kept on the phone and added
 * the next time BrainWaves opens.
 */

export interface Shared {
  title: string
  text: string
  url: string
}

/** What was shared, from the address; null when this isn't a share. */
export function readShare(): Shared | null {
  if (location.pathname !== '/share') return null
  const q = new URLSearchParams(location.search)
  const text = (q.get('text') || '').trim()
  let url = (q.get('url') || '').trim()
  // Many apps put the link inside the text, often after a description.
  if (!url) url = (text.match(/https?:\/\/\S+/) || [''])[0]
  const rest = url ? text.replace(url, '').trim() : text
  const title = (q.get('title') || '').trim()
  return { title, text: rest === title ? '' : rest, url }
}

export const leaveShare = () => history.replaceState(null, '', '/')

// ---- offline queue

const KEY = 'bw-share-queue'
const queued = (): (Shared & { mode: Mode })[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}
export function queueShare(s: Shared, mode: Mode = 'inbox') {
  try {
    localStorage.setItem(KEY, JSON.stringify([...queued(), { ...s, mode }]))
  } catch {
    /* storage full or off */
  }
}
/** Add what was shared while offline (call once the workspace is loaded). */
export async function flushShares() {
  const list = queued()
  if (!list.length) return
  const left: typeof list = []
  for (const s of list) {
    try {
      await addShare(s, s.mode, false)
    } catch {
      left.push(s)
    }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(left))
  } catch {
    /* ignore */
  }
  const done = list.length - left.length
  if (done) toast(`Added ${done} thing${done === 1 ? '' : 's'} shared while offline`)
}

// ---- writing it into BrainWaves

type Mode = 'inbox' | 'page'

/** The Inbox page (top level), made the first time something is shared. */
export async function inboxPage(): Promise<string> {
  const pages = Object.values(getState().pages)
  const found = pages.find((p) => !p.parentId && !p.databaseId && p.trashedAt == null && p.title === 'Inbox')
  if (found) return found.id
  const p = await createPage({ title: 'Inbox', icon: '📥', open: false })
  return p.id
}

type Node = JSONContent

function blocksFor(s: Shared, burrowId: number | null): Node[] {
  const out: Node[] = []
  if (s.url && burrowId) out.push(...(cardContent({ id: burrowId, url: s.url, title: s.title || null }).slice(0, 1) as Node[]))
  else if (s.url) out.push({ type: 'paragraph', content: [{ type: 'text', text: s.title || s.url, marks: [{ type: 'link', attrs: { href: s.url } }] }] })
  else if (s.title) out.push({ type: 'paragraph', content: [{ type: 'text', text: s.title, marks: [{ type: 'bold' }] }] })
  for (const line of s.text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) out.push({ type: 'paragraph', content: [{ type: 'text', text: line }] })
  return out
}

/** Put a share into the Inbox (at the top, newest first) or a new page under it. Returns the page. */
export async function addShare(s: Shared, mode: Mode, toBurrow: boolean, tags: string[] = []): Promise<string> {
  let burrowId: number | null = null
  if (toBurrow && (s.url || s.text)) {
    const b = await saveToBurrow(s.url ? { url: s.url, title: s.title || undefined, tags } : { note: s.text, title: s.title || undefined, tags })
    burrowId = b.id
  }
  const inbox = await inboxPage()
  const blocks = blocksFor(s, burrowId)
  if (mode === 'page') {
    const title = s.title || s.text.slice(0, 60) || s.url || 'Shared'
    const p = await createPage({ parentId: inbox, title, open: false })
    await withPage(p.id, (sync) => {
      sync.setContent({ type: 'doc', content: blocks })
      return sync.flush()
    })
    return p.id
  }
  const when = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  await withPage(inbox, (sync) => {
    const notes = sync.notesJSON()
    const old = (notes[0]?.content ?? []) as Node[]
    const stamp: Node = { type: 'paragraph', content: [{ type: 'text', text: when, marks: [{ type: 'italic' }] }] }
    const empty = old.length === 1 && !old[0].content?.length
    sync.setContent({ type: 'doc', content: [stamp, ...blocks, { type: 'horizontalRule' }, ...(empty ? [] : old)] })
    return sync.flush()
  })
  return inbox
}

/** The sheet shown after sharing into BrainWaves. */
export function ShareSheet({ shared, done }: { shared: Shared; done: () => void }) {
  const conn = useBurrow()
  const [title, setTitle] = useState(shared.title)
  const [text, setText] = useState(shared.text)
  const [mode, setMode] = useState<Mode>('inbox')
  const [toBurrow, setToBurrow] = useState(false)
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (conn && shared.url) setToBurrow(true)
  }, [conn, shared.url])
  const close = () => {
    leaveShare()
    done()
  }
  const save = async () => {
    setBusy(true)
    try {
      const tagList = tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean)
      const page = await addShare({ title: title.trim(), text: text.trim(), url: shared.url }, mode, toBurrow && !!conn, tagList)
      leaveShare()
      done()
      openPage(page, 'replace')
      toast(toBurrow && conn ? 'Saved, and to Burrow' : mode === 'page' ? 'Saved as a new page' : 'Added to your Inbox')
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop share-backdrop">
      <div className="share-sheet" role="dialog" aria-label="Save to BrainWaves">
        <header>
          <span>Save to BrainWaves</span>
          <button className="icon-button" aria-label="Cancel" onClick={close}>
            <X size={17} />
          </button>
        </header>
        {shared.url && <div className="share-url">{shared.url}</div>}
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={shared.url ? 'The link’s own title if empty' : 'Title'} />
        </label>
        <label>
          Note
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Anything to remember about it" />
        </label>
        <div className="share-modes">
          <button className={mode === 'inbox' ? 'on' : ''} onClick={() => setMode('inbox')}>
            <Inbox size={15} /> Add to Inbox
          </button>
          <button className={mode === 'page' ? 'on' : ''} onClick={() => setMode('page')}>
            <FilePlus2 size={15} /> New page
          </button>
        </div>
        {conn && (
          <label className="share-check">
            <input type="checkbox" checked={toBurrow} onChange={(e) => setToBurrow(e.target.checked)} /> Also save to Burrow
          </label>
        )}
        {conn && toBurrow && (
          <label>
            Burrow tags
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="reading" autoCapitalize="none" />
          </label>
        )}
        <button className="share-go" disabled={busy || (!shared.url && !title.trim() && !text.trim())} onClick={() => void save()}>
          <Send size={15} /> {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/** Shared while offline (the app couldn't reach the server): keep it on the phone. */
export function ShareOffline({ shared }: { shared: Shared }) {
  const [saved, setSaved] = useState(false)
  return (
    <main className="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">✦</span> BrainWaves
        </div>
        <h1>You're offline</h1>
        <p className="login-hint">{saved ? 'Kept on this phone: it goes into your Inbox the next time you open BrainWaves.' : 'BrainWaves can keep this on your phone and add it to your Inbox when you’re back online.'}</p>
        <p className="login-hint small">{shared.url || shared.title || shared.text}</p>
        {!saved && (
          <button
            className="login-go"
            onClick={() => {
              queueShare(shared)
              leaveShare()
              setSaved(true)
            }}
          >
            Keep it for later
          </button>
        )}
      </div>
    </main>
  )
}
