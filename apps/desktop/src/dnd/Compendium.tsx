import { ArrowLeft, BookOpen, Check, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '../state/store'
import { CATEGORIES, enabledSources, entries, fetchData, find, getSource, listBooks, reload, search, setEnabledSources, setSource, type Book, type Category, type Entry, type Ref } from './fivee'
import { OpenRef } from './render'
import { Statblock } from './Statblock'

/**
 * The 5e compendium: search the user's 5etools content, read an entry, follow its links, and
 * (when opened from a page) insert it as a card.
 */

interface Request {
  cats?: Category[]
  /** Insert mode: called with the chosen entry. */
  onPick?: (ref: Ref) => void
  /** Open straight on this entry. */
  open?: Ref
  title?: string
}

let current: Request | null = null
const listeners = new Set<() => void>()
const set = (r: Request | null) => {
  current = r
  listeners.forEach((l) => l())
}
export const openCompendium = (r: Request = {}) => set(r)
const useRequest = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current)

export function CompendiumHost() {
  const req = useRequest()
  return req ? <Compendium req={req} close={() => set(null)} /> : null
}

function Compendium({ req, close }: { req: Request; close: () => void }) {
  const allowed = req.cats ?? CATEGORIES.map((c) => c.id)
  const [cats, setCats] = useState<Category[]>(allowed)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stack, setStack] = useState<Entry[]>([])
  const [settings, setSettings] = useState(false)
  const [source, setSrc] = useState<string | null | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)
  const current = stack[stack.length - 1]

  useEffect(() => {
    void getSource().then((s) => {
      setSrc(s)
      if (!s) setSettings(true)
    })
  }, [])

  useEffect(() => {
    if (!source) return
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      search(q, cats).then(
        (r) => live && (setResults(r), setError(null), setLoading(false)),
        (e) => live && (setError(String(e).replace(/^Error:\s*/, '')), setLoading(false)),
      )
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, cats, source])

  useEffect(() => {
    if (!req.open || !source) return
    void find(req.open).then((e) => e && setStack([e]))
  }, [req.open, source])

  const openRef = async (r: Ref) => {
    const e = await find(r)
    if (e) setStack((s) => [...s, e])
    else toast(`${r.name} isn't in your 5etools`)
  }

  const pick = (e: Entry) => {
    req.onPick?.({ cat: e.cat, name: e.name, source: e.source })
    close()
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="fv-compendium dnd-theme" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Compendium">
        <header className="fv-comp-head">
          <BookOpen size={18} />
          <span className="fv-comp-title">{req.title ?? (req.onPick ? 'Insert from the compendium' : 'Compendium')}</span>
          <button className="fv-icon" title="5etools settings" aria-label="Settings" onClick={() => setSettings((v) => !v)}>
            <Settings2 size={15} />
          </button>
          <button className="fv-icon" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </header>
        {settings && (
          <>
            <SourceSettings
              source={source ?? null}
              onSaved={(s) => {
                reload()
                setSrc(s)
                setSettings(false)
                input.current?.focus()
              }}
            />
            {source && (
              <BookSettings
                onSaved={() => {
                  setSettings(false)
                  setQ((x) => x + ' ')
                  setTimeout(() => setQ((x) => x.trimEnd()))
                }}
              />
            )}
          </>
        )}
        {source && (
          <div className="fv-comp-main">
            <div className="fv-comp-list">
              <label className="fv-search">
                <Search size={14} />
                <input ref={input} autoFocus placeholder="Search spells, monsters, items…" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              {allowed.length > 1 && (
                <div className="fv-chips">
                  {CATEGORIES.filter((c) => allowed.includes(c.id)).map((c) => {
                    const on = cats.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        className={`fv-chip ${on ? 'on' : ''}`}
                        onClick={(e) => setCats(e.shiftKey || cats.length === allowed.length ? [c.id] : on ? (cats.length > 1 ? cats.filter((x) => x !== c.id) : allowed) : [...cats, c.id])}
                        title="Click to show only this; click again to add others back"
                      >
                        {c.icon} {c.plural}
                      </button>
                    )
                  })}
                </div>
              )}
              {error && <div className="fv-error">{error}</div>}
              <ul className="fv-results" aria-busy={loading}>
                {results.map((e) => (
                  <li key={`${e.cat}|${e.name}|${e.source}`} className={current === e ? 'active' : ''} onClick={() => setStack([e])} onDoubleClick={() => req.onPick && pick(e)}>
                    <span className="fv-res-icon">{CATEGORIES.find((c) => c.id === e.cat)!.icon}</span>
                    <span className="fv-res-name">{e.name}</span>
                    <span className="fv-res-meta">{meta(e)}</span>
                    <span className="fv-res-src">{e.source}</span>
                  </li>
                ))}
                {!loading && !error && results.length === 0 && <li className="fv-empty">Nothing found{q ? ` for “${q}”` : ''}.</li>}
              </ul>
            </div>
            <div className="fv-comp-detail">
              {current ? (
                <>
                  <div className="fv-detail-bar">
                    {stack.length > 1 && (
                      <button className="fv-btn ghost" onClick={() => setStack((s) => s.slice(0, -1))}>
                        <ArrowLeft size={13} /> {stack[stack.length - 2].name}
                      </button>
                    )}
                    <span className="fv-grow" />
                    {req.onPick && (
                      <button className="fv-btn" onClick={() => pick(current)}>
                        <Plus size={13} /> Insert
                      </button>
                    )}
                  </div>
                  <OpenRef.Provider value={(r) => void openRef(r)}>
                    <Statblock entry={current} />
                  </OpenRef.Provider>
                </>
              ) : (
                <div className="fv-detail-empty">Choose an entry to read it{req.onPick ? ', then Insert it into the page' : ''}.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}

function meta(e: Entry): string {
  const r = e.raw
  switch (e.cat) {
    case 'spell':
      return r.level === 0 ? 'cantrip' : `lvl ${r.level}`
    case 'monster':
      return `CR ${typeof r.cr === 'object' ? r.cr?.cr : r.cr ?? '—'}`
    case 'item':
      return r.rarity && r.rarity !== 'none' ? r.rarity : ''
    default:
      return ''
  }
}

/** Where the user's 5etools runs. "Test" fetches its spell index. */
function SourceSettings({ source, onSaved }: { source: string | null; onSaved: (s: string) => void }) {
  const [url, setUrl] = useState(source ?? 'http://localhost:5050/')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const s = await setSource(url)
      reload()
      await fetchData('data/spells/index.json', true)
      const n = (await entries('spell')).length
      setStatus(`Connected: ${n} spells found.`)
      onSaved(s)
    } catch (e) {
      setStatus(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fv-settings">
      <p>
        BrainWaves reads 5e content from <strong>your own 5etools site</strong> (its <code>data/</code> files). Enter the address
        where it runs, for example <code>http://localhost:5050/</code>. Nothing from it is copied into your notes, only references.
      </p>
      <div className="fv-settings-row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:5050/" onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <button className="fv-btn" disabled={busy} onClick={() => void save()}>
          {busy ? <RefreshCw size={13} className="spin" /> : <Check size={13} />} Save & test
        </button>
      </div>
      {status && <div className={/^Connected/.test(status) ? 'fv-ok' : 'fv-error'}>{status}</div>}
    </div>
  )
}

const GROUPS: [string, string][] = [
  ['core', 'Core rules'],
  ['supplement', 'Supplements'],
  ['setting', 'Settings'],
  ['supplement-alt', 'Other supplements'],
  ['prerelease', 'Previews'],
  ['homebrew', 'Homebrew'],
  ['screen', 'Screens'],
  ['recipe', 'Recipes'],
  ['other', 'Other'],
  ['adventure', 'Adventures'],
]

/**
 * Which books BrainWaves uses: 5etools loads everything, so turn off what you don't play with.
 * Search, the character builder and what's published to the table follow this; cards already in
 * pages keep working.
 */
function BookSettings({ onSaved }: { onSaved: () => void }) {
  const [books, setBooks] = useState<Book[] | null>(null)
  const [on, setOn] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    Promise.all([listBooks(), enabledSources()]).then(
      ([b, en]) => {
        setBooks(b)
        setOn(new Set(en ? [...en] : b.map((x) => x.id.toUpperCase())))
      },
      (e) => setError(String(e).replace(/^Error:\s*/, '')),
    )
  }, [])
  if (error) return <div className="fv-settings"><div className="fv-error">{error}</div></div>
  if (!books) return <div className="fv-settings"><p>Reading your 5etools books…</p></div>
  const ids = books.map((b) => b.id.toUpperCase())
  const toggle = (id: string) => {
    const n = new Set(on)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setOn(n)
  }
  const setMany = (list: string[], value: boolean) => {
    const n = new Set(on)
    list.forEach((id) => (value ? n.add(id) : n.delete(id)))
    setOn(n)
  }
  const save = async () => {
    const all = ids.every((id) => on.has(id))
    await setEnabledSources(all ? null : [...on])
    toast(all ? 'Using every book' : `Using ${on.size} of ${ids.length} books`)
    onSaved()
  }
  const shown = books.filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()) || b.id.toLowerCase().includes(q.toLowerCase()))
  const groups = GROUPS.map(([g, label]) => [label, shown.filter((b) => (GROUPS.some(([x]) => x === b.group) ? b.group : 'other') === g)] as const).filter(([, l]) => l.length)
  return (
    <div className="fv-settings fv-books">
      <p>
        <strong>Books to use.</strong> 5etools loads every book; turn off the ones you don't play with. Search, the character builder and
        what you publish to the table use only these. <span className="fv-muted">{on.size} of {ids.length} on.</span>
      </p>
      <div className="fv-settings-row">
        <input placeholder="Find a book…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="fv-btn ghost" onClick={() => setOn(new Set(ids))}>All</button>
        <button className="fv-btn ghost" onClick={() => setOn(new Set(books.filter((b) => b.group === 'core').map((b) => b.id.toUpperCase())))}>Core only</button>
        <button className="fv-btn ghost" onClick={() => setOn(new Set())}>None</button>
      </div>
      <div className="fv-book-groups">
        {groups.map(([label, list]) => (
          <section key={label}>
            <h5>
              {label}
              <button className="fv-link-btn" onClick={() => setMany(list.map((b) => b.id.toUpperCase()), !list.every((b) => on.has(b.id.toUpperCase())))}>
                {list.every((b) => on.has(b.id.toUpperCase())) ? 'none' : 'all'}
              </button>
            </h5>
            {list.map((b) => (
              <label key={b.id} className="fv-book">
                <input type="checkbox" checked={on.has(b.id.toUpperCase())} onChange={() => toggle(b.id.toUpperCase())} />
                <span>{b.name}</span>
                <small>{b.id}</small>
              </label>
            ))}
          </section>
        ))}
      </div>
      <div className="fv-settings-row">
        <button className="fv-btn" onClick={() => void save()}>
          <Check size={13} /> Save books
        </button>
      </div>
    </div>
  )
}

/** Look an entry up for a card in a page. */
export function useEntry(ref: Ref | null) {
  const [state, setState] = useState<{ entry: Entry | null; error: string | null; loading: boolean }>({ entry: null, error: null, loading: true })
  const key = ref ? `${ref.cat}|${ref.name}|${ref.source}` : ''
  useEffect(() => {
    if (!ref) return
    let live = true
    setState((s) => ({ ...s, loading: true }))
    find(ref).then(
      (entry) => live && setState({ entry, error: entry ? null : `${ref.name} isn't in your 5etools`, loading: false }),
      (e) => live && setState({ entry: null, error: String(e).replace(/^Error:\s*/, ''), loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

export const useCategories = () => useMemo(() => CATEGORIES, [])
