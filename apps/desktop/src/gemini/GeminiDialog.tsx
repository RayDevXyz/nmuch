import { generateHTML, type JSONContent } from '@tiptap/core'
import { schemaExtensions } from '@brainwaves/editor'
import { Check, ClipboardCopy, KeyRound, Loader2, MessageSquare, RotateCcw, ScrollText, Send, Sparkles, Trash2, Upload, Wand2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { createRow } from '../database/api'
import { markdownToContent } from '../lib/convert'
import { uid } from '../lib/id'
import { openPage, withPage } from '../state/actions'
import { getState, toast } from '../state/store'
import { pageMarkdown } from '../editor/Editor'
import { ask, askJSON, geminiStatus, MODELS, setGeminiKey, type GeminiStatus, type Message } from './api'
import { campaignContext, campaignData } from './context'
import { createWorld, KIND_LABEL, titlesIn, waitFor, writeInto, type WorldItem, type WorldKind } from './create'
import { splitImport } from './importText'
import { EXPAND, SESSION_JSON, SORT_JSON, SYSTEM, WORLD_JSON } from './prompts'
import './gemini.css'

/**
 * Gemini in BrainWaves: one window for building the world (new NPCs, locations, factions and
 * lore), writing into a page, a chat that knows the campaign, planning a session, bringing in
 * what you wrote in the Gemini app, and the API key.
 */

export type GeminiMode = 'create' | 'expand' | 'chat' | 'session' | 'import' | 'settings'
export interface GeminiOpen {
  mode: GeminiMode
  campaignId?: string | null
  pageId?: string | null
  /** Put text at the editor's cursor instead of the end of the page (from the / menu). */
  insert?: (content: JSONContent[]) => void
}

let current: GeminiOpen | null = null
const subs = new Set<() => void>()
export function openGemini(o: GeminiOpen) {
  current = o
  subs.forEach((f) => f())
}
const closeGemini = () => openGemini(null as unknown as GeminiOpen)
const useOpen = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current,
  )

const TITLES: Record<GeminiMode, string> = {
  create: 'Create with Gemini',
  expand: 'Write with Gemini',
  chat: 'Chat about the campaign',
  session: 'Plan a session',
  import: 'Bring in from Gemini',
  settings: 'Gemini',
}
const ICONS: Record<GeminiMode, React.ReactNode> = {
  create: <Wand2 size={16} />,
  expand: <Sparkles size={16} />,
  chat: <MessageSquare size={16} />,
  session: <ScrollText size={16} />,
  import: <Upload size={16} />,
  settings: <KeyRound size={16} />,
}

export function GeminiHost() {
  const o = useOpen()
  const [status, setStatus] = useState<GeminiStatus | null>(null)
  useEffect(() => {
    if (o) void geminiStatus().then(setStatus, () => setStatus({ configured: false, hint: null, model: 'gemini-2.5-flash' }))
  }, [o])
  useEffect(() => {
    if (!o) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeGemini()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [o])
  if (!o) return null
  // Bringing in pasted text works without a key; everything else needs one.
  const needsKey = o.mode !== 'import' && status && !status.configured
  return (
    <div className="modal-backdrop gm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeGemini()}>
      <div className={`gm-dialog gm-${o.mode}`} role="dialog" aria-label={TITLES[o.mode]}>
        <header className="gm-head">
          <span>
            {ICONS[o.mode]} {TITLES[o.mode]}
          </span>
          {status?.configured && o.mode !== 'settings' && (
            <button className="gm-link" onClick={() => openGemini({ ...o, mode: 'settings' })} title="Gemini key and model">
              {MODELS.find((m) => m.id === status.model)?.label.split(' (')[0] ?? status.model}
            </button>
          )}
          <button className="icon-button" aria-label="Close" onClick={closeGemini}>
            <X size={16} />
          </button>
        </header>
        {!status ? (
          <div className="gm-body">
            <Busy text="…" />
          </div>
        ) : needsKey || o.mode === 'settings' ? (
          <KeyForm status={status} onSaved={(s) => (setStatus(s), o.mode === 'settings' ? closeGemini() : null)} />
        ) : o.mode === 'create' ? (
          <CreateView o={o} />
        ) : o.mode === 'expand' ? (
          <ExpandView o={o} />
        ) : o.mode === 'chat' ? (
          <ChatView o={o} />
        ) : o.mode === 'session' ? (
          <SessionView o={o} />
        ) : (
          <ImportView o={o} canSort={!!status.configured} />
        )}
      </div>
    </div>
  )
}

function Busy({ text }: { text: string }) {
  return (
    <p className="gm-busy">
      <Loader2 size={14} className="spin" /> {text}
    </p>
  )
}

/** Markdown shown as it will look in a page. */
function Preview({ md, campaignId }: { md: string; campaignId?: string | null }) {
  const html = useMemo(() => {
    const titles = campaignId ? titlesIn(campaignId) : new Map<string, string>()
    const content = markdownToContent(md, (t) => titles.get(t.toLowerCase()) ?? null) ?? []
    try {
      return generateHTML({ type: 'doc', content }, schemaExtensions())
    } catch {
      return ''
    }
  }, [md, campaignId])
  return html ? <div className="gm-md" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="gm-md">{md}</pre>
}

// ---------------------------------------------------------------- the key

function KeyForm({ status, onSaved }: { status: GeminiStatus; onSaved: (s: GeminiStatus) => void }) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState(status.model)
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState('')
  const save = async (andTest: boolean) => {
    setBusy(true)
    setTest('')
    try {
      const s = await setGeminiKey({ ...(key.trim() ? { key: key.trim() } : {}), model })
      if (andTest) {
        const answer = await ask('Answer in five words or fewer.', [{ role: 'user', text: 'Say hello to a Dungeon Master.' }])
        setTest(`Gemini says: ${answer.trim()}`)
      }
      setKey('')
      onSaved(s)
      toast('Gemini is ready')
    } catch (e) {
      setTest(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gm-body gm-key">
      <p>
        BrainWaves talks to Gemini with your own <b>Gemini API key</b>. Get one for free at{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          aistudio.google.com/apikey
        </a>{' '}
        (sign in with your Google account, then <i>Create API key</i>).
      </p>
      <label>
        API key {status.configured && <small>(one is saved, ending in …{status.hint}; leave empty to keep it)</small>}
        <input type="password" autoComplete="off" placeholder={status.configured ? '••••••••' : 'AIza…'} value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <label>
        Model
        <select value={MODELS.some((m) => m.id === model) ? model : 'other'} onChange={(e) => e.target.value !== 'other' && setModel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value="other">Another model…</option>
        </select>
      </label>
      {!MODELS.some((m) => m.id === model) || model === '' ? <input placeholder="gemini-…" value={model} onChange={(e) => setModel(e.target.value.trim())} /> : null}
      <p className="gm-hint">The key stays on your BrainWaves (your server, or this computer); the app never shows it again. What you ask, with the campaign notes you include, goes to Google.</p>
      {test && <p className={`gm-test ${test.startsWith('Gemini says') ? 'ok' : 'bad'}`}>{test}</p>}
      <div className="gm-actions">
        {status.configured && (
          <button className="gm-btn" disabled={busy} onClick={() => void setGeminiKey({ key: '' }).then((s) => (onSaved(s), toast('Gemini key removed')))}>
            <Trash2 size={13} /> Remove key
          </button>
        )}
        <span className="gm-spacer" />
        <button className="gm-btn" disabled={busy || (!key.trim() && !status.configured)} onClick={() => void save(false)}>
          Save
        </button>
        <button className="gm-btn primary" disabled={busy || (!key.trim() && !status.configured)} onClick={() => void save(true)}>
          {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save and test
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- create world pages

const KIND_CHIPS: { id: WorldKind | 'any'; label: string }[] = [
  { id: 'any', label: 'Anything' },
  { id: 'npc', label: 'NPCs' },
  { id: 'location', label: 'Locations' },
  { id: 'faction', label: 'Factions' },
  { id: 'lore', label: 'Lore' },
]

function CreateView({ o }: { o: GeminiOpen }) {
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<WorldKind | 'any'>('any')
  const [count, setCount] = useState(3)
  const [useCampaign, setUseCampaign] = useState(true)
  const [busy, setBusy] = useState('')
  const [items, setItems] = useState<WorldItem[] | null>(null)
  const run = async () => {
    if (!o.campaignId) return
    setBusy('Gemini is writing…')
    try {
      const ctx = useCampaign ? await campaignContext(o.campaignId) : ''
      const what = kind === 'any' ? `${count} campaign pages (NPCs, locations, factions or lore, whatever fits)` : `${count} ${KIND_LABEL[kind]}${count > 1 ? 's' : ''}`
      const r = await askJSON<{ items: WorldItem[] }>(SYSTEM, `${ctx ? `Campaign notes:\n${ctx}\n\n` : ''}Make ${what}.\nWhat the DM asks for: ${prompt || '(nothing specific: surprise me, fitting the campaign)'}\n\n${WORLD_JSON}`)
      const list = (r.items ?? []).filter((x) => x && x.title).map((x) => ({ ...x, kind: (['npc', 'location', 'faction', 'lore'] as const).includes(x.kind) ? x.kind : 'lore', keep: true }))
      if (!list.length) throw new Error('Gemini made nothing. Try asking differently.')
      setItems(list)
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy('')
    }
  }
  if (items) return <ItemsPreview campaignId={o.campaignId!} items={items} onItems={setItems} onBack={() => setItems(null)} onAgain={() => void run()} />
  return (
    <div className="gm-body">
      <div className="gm-chips">
        {KIND_CHIPS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
        <label className="gm-count">
          How many
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        autoFocus
        rows={4}
        placeholder="The harbour district of Saltmarsh: a smuggler captain, the dockmaster who looks away, and the tavern where they meet…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && void run()}
      />
      <label className="gm-check">
        <input type="checkbox" checked={useCampaign} onChange={(e) => setUseCampaign(e.target.checked)} /> Give Gemini the campaign’s notes (NPCs, locations, factions, story), so it fits in and links to them
      </label>
      {busy ? (
        <Busy text={busy} />
      ) : (
        <div className="gm-actions">
          <span className="gm-hint">You see everything before it’s added.</span>
          <span className="gm-spacer" />
          <button className="gm-btn primary" onClick={() => void run()}>
            <Wand2 size={13} /> Create
          </button>
        </div>
      )}
    </div>
  )
}

/** Gemini's pages before they're added: keep, retitle, change their kind. */
function ItemsPreview({ campaignId, items, onItems, onBack, onAgain }: { campaignId: string; items: WorldItem[]; onItems: (i: WorldItem[]) => void; onBack: () => void; onAgain?: () => void }) {
  const [open, setOpen] = useState(0)
  const [busy, setBusy] = useState(false)
  const set = (i: number, patch: Partial<WorldItem>) => onItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const kept = items.filter((x) => x.keep !== false)
  const add = async () => {
    setBusy(true)
    try {
      const ids = await createWorld(campaignId, kept)
      toast(`Added ${ids.length} page${ids.length === 1 ? '' : 's'} to the campaign`)
      closeGemini()
      if (ids[0]) openPage(ids[0], 'tab')
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
      setBusy(false)
    }
  }
  return (
    <div className="gm-body">
      <ul className="gm-items">
        {items.map((it, i) => (
          <li key={i} className={`${it.keep === false ? 'off' : ''} ${open === i ? 'open' : ''}`}>
            <div className="gm-item-head">
              <input type="checkbox" checked={it.keep !== false} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={`Add ${it.title}`} />
              <select value={it.kind} onChange={(e) => set(i, { kind: e.target.value as WorldKind })}>
                {(Object.keys(KIND_LABEL) as WorldKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <input className="gm-title" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
              <button className="gm-link" onClick={() => setOpen(open === i ? -1 : i)}>
                {open === i ? 'Hide' : 'Read'}
              </button>
            </div>
            {(it.role || it.locationKind || it.goal || it.location || it.faction) && (
              <p className="gm-facts">{[it.role, it.attitude, it.locationKind, it.goal, it.location && `at ${it.location}`, it.faction && `of ${it.faction}`].filter(Boolean).join(' · ')}</p>
            )}
            {open === i && <Preview md={it.body ?? ''} campaignId={campaignId} />}
          </li>
        ))}
      </ul>
      <div className="gm-actions">
        <button className="gm-btn" disabled={busy} onClick={onBack}>
          Back
        </button>
        {onAgain && (
          <button className="gm-btn" disabled={busy} onClick={onAgain}>
            <RotateCcw size={13} /> Try again
          </button>
        )}
        <span className="gm-spacer" />
        <button className="gm-btn primary" disabled={busy || !kept.length} onClick={() => void add()}>
          {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Add {kept.length} page{kept.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- write into a page

function ExpandView({ o }: { o: GeminiOpen }) {
  const page = getState().pages[o.pageId ?? '']
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [last, setLast] = useState('')
  const run = async (instruction: string) => {
    if (!page) return
    setLast(instruction)
    setBusy(true)
    try {
      const [ctx, text] = await Promise.all([o.campaignId ? campaignContext(o.campaignId, 300) : Promise.resolve(''), pageMarkdown(page.id).catch(() => '')])
      const md = await ask(SYSTEM, [
        {
          role: 'user',
          text: `${ctx ? `Campaign notes:\n${ctx}\n\n` : ''}The page "${page.title || 'Untitled'}" says:\n${text || '(nothing yet)'}\n\n${instruction}\nAnswer with only the new Markdown to add to the page.`,
        },
      ])
      setResult(md.trim())
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }
  const put = async (mode: 'append' | 'replace' | 'cursor') => {
    if (!result || !page) return
    const titles = o.campaignId ? titlesIn(o.campaignId) : new Map<string, string>()
    if (mode === 'cursor' && o.insert) o.insert(markdownToContent(result, (t) => titles.get(t.toLowerCase()) ?? null) ?? [])
    else await writeInto(page.id, result, mode === 'replace' ? 'replace' : 'append', titles)
    toast(mode === 'replace' ? 'Page rewritten' : 'Added to the page')
    closeGemini()
  }
  if (!page) return <div className="gm-body">Open a page first.</div>
  return (
    <div className="gm-body">
      <p className="gm-hint">
        On <b>{page.title || 'Untitled'}</b>
        {o.campaignId ? ', with the campaign’s notes.' : '.'}
      </p>
      {!result && (
        <>
          <div className="gm-chips wrap">
            {Object.entries(EXPAND).map(([id, x]) => (
              <button key={id} disabled={busy} onClick={() => void run(x.ask)}>
                {x.label}
              </button>
            ))}
          </div>
          <textarea rows={3} placeholder="Or say what to write: “a tragic backstory tied to the Black Spider”, “three tavern patrons with something to hide”…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && custom.trim() && void run(custom.trim())} />
          {busy ? (
            <Busy text="Gemini is writing…" />
          ) : (
            <div className="gm-actions">
              <span className="gm-spacer" />
              <button className="gm-btn primary" disabled={!custom.trim()} onClick={() => void run(custom.trim())}>
                <Sparkles size={13} /> Write
              </button>
            </div>
          )}
        </>
      )}
      {result && (
        <>
          <div className="gm-result">
            <Preview md={result} campaignId={o.campaignId} />
          </div>
          <div className="gm-actions">
            <button className="gm-btn" disabled={busy} onClick={() => setResult(null)}>
              Back
            </button>
            <button className="gm-btn" disabled={busy} onClick={() => void run(last)}>
              {busy ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />} Try again
            </button>
            <span className="gm-spacer" />
            <button className="gm-btn" onClick={() => void put('replace')} title="Replace the page's text with this">
              Replace page
            </button>
            <button className="gm-btn primary" onClick={() => void put(o.insert ? 'cursor' : 'append')}>
              <Check size={13} /> {o.insert ? 'Insert here' : 'Add to the page'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- chat with the campaign

interface ChatMsg extends Message {
  at: number
}
const chatOf = (doc: Y.Doc) => doc.getArray('geminiChat') as Y.Array<ChatMsg>

function ChatView({ o }: { o: GeminiOpen }) {
  const id = o.campaignId!
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [withNotes, setWithNotes] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void withPage(id, (s) => setMsgs(chatOf(s.doc).toArray()))
  }, [id])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs, busy])
  const push = (m: ChatMsg[]) =>
    withPage(id, (s) => {
      chatOf(s.doc).push(m)
      setMsgs(chatOf(s.doc).toArray())
      return s.flush()
    })
  const send = async () => {
    const q = text.trim()
    if (!q || busy) return
    setText('')
    const mine: ChatMsg = { role: 'user', text: q, at: Date.now() }
    await push([mine])
    setBusy(true)
    try {
      const ctx = withNotes ? await campaignContext(id, 400) : ''
      const history = [...msgs, mine].slice(-30).map(({ role, text }) => ({ role, text }))
      const answer = await ask(`${SYSTEM}${ctx ? `\n\nThe campaign notes:\n${ctx}` : ''}`, history)
      await push([{ role: 'model', text: answer.trim(), at: Date.now() }])
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }
  const clear = () =>
    void withPage(id, (s) => {
      chatOf(s.doc).delete(0, chatOf(s.doc).length)
      setMsgs([])
      return s.flush()
    })
  return (
    <div className="gm-body gm-chat">
      <div className="gm-log">
        {!msgs.length && !busy && (
          <p className="gm-hint">
            Ask anything about your world: “What does the Zhentarim want in Phandalin?”, “Give me a twist for next session”, “Name five taverns in the harbour”. Gemini knows the campaign’s NPCs, places, factions and story. Save
            any answer as a page.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`gm-msg ${m.role}`}>
            {m.role === 'model' ? <Preview md={m.text} campaignId={id} /> : <p>{m.text}</p>}
            {m.role === 'model' && (
              <div className="gm-msg-actions">
                {saving === i ? (
                  (Object.keys(KIND_LABEL) as WorldKind[]).map((k) => (
                    <button key={k} onClick={() => void saveAs(id, m.text, k, msgs[i - 1]?.text ?? '').then(() => setSaving(null))}>
                      as {KIND_LABEL[k]}
                    </button>
                  ))
                ) : (
                  <>
                    <button onClick={() => setSaving(i)}>Save as a page…</button>
                    <button onClick={() => void navigator.clipboard?.writeText(m.text).then(() => toast('Copied'))}>
                      <ClipboardCopy size={11} /> Copy
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <Busy text="Gemini is thinking…" />}
        <div ref={end} />
      </div>
      <div className="gm-compose">
        <textarea
          autoFocus
          rows={2}
          placeholder="Ask about your campaign…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="gm-btn primary" aria-label="Send" disabled={busy || !text.trim()} onClick={() => void send()}>
          <Send size={14} />
        </button>
      </div>
      <div className="gm-actions">
        <label className="gm-check">
          <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} /> include the campaign’s notes
        </label>
        <span className="gm-spacer" />
        {msgs.length > 0 && (
          <button className="gm-btn" onClick={clear}>
            <Trash2 size={13} /> Clear chat
          </button>
        )}
      </div>
    </div>
  )
}

/** An answer saved as a page of the campaign; its title is its first heading, or the question. */
async function saveAs(campaignId: string, md: string, kind: WorldKind, question: string) {
  const heading = /^#{1,3}\s+(.+)$/m.exec(md)?.[1] ?? /\*\*([^*]{3,60})\*\*/.exec(md)?.[1]
  const title = window.prompt('Title of the page', (heading ?? question.slice(0, 60)).replace(/[*_#]/g, '').trim())
  if (title === null) return
  const body = heading ? md.replace(/^#{1,3}\s+.+\n+/m, '') : md
  const [id] = await createWorld(campaignId, [{ kind, title: title || 'Untitled', body }])
  toast(`Saved as ${KIND_LABEL[kind].toLowerCase()}: ${title}`)
  if (id) openPage(id, 'tab')
}

// ---------------------------------------------------------------- plan a session

interface SessionPlan {
  session: { title: string; summary: string; body: string }
  beats: { title: string; notes: string; arc?: string; npcs?: string[]; locations?: string[]; factions?: string[]; keep?: boolean }[]
}

function SessionView({ o }: { o: GeminiOpen }) {
  const id = o.campaignId!
  const [recap, setRecap] = useState('')
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState('')
  const [plan, setPlan] = useState<SessionPlan | null>(null)
  const [next, setNext] = useState(1)
  useEffect(() => {
    void campaignData(id).then((d) => {
      const rows = d.sessions?.rows ?? []
      const nums = rows.map((r) => Number(r.values.number) || 0)
      setNext((nums.length ? Math.max(...nums) : 0) + 1)
      const last = [...rows].sort((a, b) => (Number(b.values.number) || 0) - (Number(a.values.number) || 0))[0]
      if (last?.values.summary) setRecap(String(last.values.summary))
    })
  }, [id])
  const run = async () => {
    setBusy('Gemini is planning…')
    try {
      const ctx = await campaignContext(id, 400)
      const p = await askJSON<SessionPlan>(SYSTEM, `Campaign notes:\n${ctx}\n\nPlan session ${next}.\nWhat happened last time: ${recap || '(see the notes)'}\nWhat the DM wants this session: ${focus || '(continue the story; push the planned beats forward)'}\nPlan 3 to 6 new story beats that move the campaign forward.\n\n${SESSION_JSON}`)
      if (!p.session?.body) throw new Error('Gemini’s plan came back empty. Try again.')
      setPlan({ ...p, beats: (p.beats ?? []).map((b) => ({ ...b, keep: true })) })
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy('')
    }
  }
  const add = async () => {
    if (!plan) return
    setBusy('Adding…')
    try {
      const d = await campaignData(id)
      const parts = d.campaign.parts!
      const titles = titlesIn(id)
      const sid = uid()
      await createRow(parts.sessions, sid, plan.session.title || `Session ${next}`, { number: next, summary: plan.session.summary ?? '' })
      const order = Math.max(0, ...(d.beats?.rows ?? []).map((r) => Number(r.values.order) || 0))
      const rel = (names: string[] | undefined) => (names ?? []).map((n) => titles.get(n.toLowerCase())).filter((x): x is string => !!x)
      let i = 0
      for (const b of plan.beats.filter((x) => x.keep !== false)) {
        i++
        await createRow(parts.beats, uid(), b.title, {
          status: 'planned',
          arc: b.arc ?? '',
          order: order + i,
          notes: b.notes ?? '',
          [parts.beatSession]: [sid],
          [parts.beatNpcs]: rel(b.npcs),
          [parts.beatLocations]: rel(b.locations),
          [parts.beatFactions]: rel(b.factions),
        })
      }
      await waitFor(sid)
      await writeInto(sid, plan.session.body, 'replace', titles)
      toast(`Session ${next} planned, with ${i} story beat${i === 1 ? '' : 's'}`)
      closeGemini()
      openPage(sid, 'tab')
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
      setBusy('')
    }
  }
  if (plan)
    return (
      <div className="gm-body">
        <h4 className="gm-sub">{plan.session.title}</h4>
        <div className="gm-result">
          <Preview md={plan.session.body} campaignId={id} />
        </div>
        <h4 className="gm-sub">New story beats</h4>
        <ul className="gm-items">
          {plan.beats.map((b, i) => (
            <li key={i} className={b.keep === false ? 'off' : ''}>
              <div className="gm-item-head">
                <input type="checkbox" checked={b.keep !== false} onChange={(e) => setPlan({ ...plan, beats: plan.beats.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)) })} />
                <b>{b.title}</b>
              </div>
              <p className="gm-facts">{b.notes}</p>
            </li>
          ))}
        </ul>
        {busy ? (
          <Busy text={busy} />
        ) : (
          <div className="gm-actions">
            <button className="gm-btn" onClick={() => setPlan(null)}>
              Back
            </button>
            <button className="gm-btn" onClick={() => void run()}>
              <RotateCcw size={13} /> Try again
            </button>
            <span className="gm-spacer" />
            <button className="gm-btn primary" onClick={() => void add()}>
              <Check size={13} /> Add session {next}
            </button>
          </div>
        )}
      </div>
    )
  return (
    <div className="gm-body">
      <label className="gm-field">
        What happened last session
        <textarea rows={3} value={recap} onChange={(e) => setRecap(e.target.value)} placeholder="The party cleared Cragmaw Hideout and freed Sildar…" />
      </label>
      <label className="gm-field">
        What you want in session {next}
        <textarea autoFocus rows={3} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Arrive in Phandalin, meet the Redbrands, a social encounter and one fight…" />
      </label>
      {busy ? (
        <Busy text={busy} />
      ) : (
        <div className="gm-actions">
          <span className="gm-hint">Gemini reads the campaign’s notes, story beats and sessions.</span>
          <span className="gm-spacer" />
          <button className="gm-btn primary" onClick={() => void run()}>
            <ScrollText size={13} /> Plan it
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- bring in from the Gemini app

function ImportView({ o, canSort }: { o: GeminiOpen; canSort: boolean }) {
  const [text, setText] = useState('')
  const [items, setItems] = useState<WorldItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const split = () => {
    const list = splitImport(text)
    if (!list.length) return toast('Nothing to bring in: paste Gemini’s answer first')
    setItems(list)
  }
  const sort = async () => {
    setBusy(true)
    try {
      const r = await askJSON<{ items: WorldItem[] }>(SYSTEM, `${SORT_JSON}\n\nThe text:\n${text}`, 0.3)
      setItems((r.items ?? []).filter((x) => x?.title).map((x) => ({ ...x, keep: true })))
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }
  if (items && o.campaignId) return <ItemsPreview campaignId={o.campaignId} items={items} onItems={setItems} onBack={() => setItems(null)} />
  return (
    <div className="gm-body">
      <p className="gm-hint">
        In the Gemini app, use <b>Copy</b> under an answer (or <i>Share &amp; export → Export to Docs</i>, then copy), and paste it here. You can also open a saved <b>.md</b>, <b>.txt</b> or <b>.html</b> file (for example from
        Google Takeout). Each heading becomes a page; you choose what each one is.
      </p>
      <textarea autoFocus rows={10} placeholder="Paste Gemini’s answer here…" value={text} onChange={(e) => setText(e.target.value)} />
      <input
        ref={file}
        type="file"
        accept=".md,.markdown,.txt,.html,.htm,text/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) setText(await f.text())
        }}
      />
      {busy ? (
        <Busy text="Gemini is sorting it into pages…" />
      ) : (
        <div className="gm-actions">
          <button className="gm-btn" onClick={() => file.current?.click()}>
            <Upload size={13} /> Open a file…
          </button>
          <span className="gm-spacer" />
          {canSort && (
            <button className="gm-btn" disabled={!text.trim()} onClick={() => void sort()} title="Gemini splits it into NPCs, locations and factions, and fills in their details">
              <Wand2 size={13} /> Let Gemini sort it
            </button>
          )}
          <button className="gm-btn primary" disabled={!text.trim()} onClick={split}>
            Split into pages
          </button>
        </div>
      )}
    </div>
  )
}
