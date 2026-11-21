import { Archive, Bookmark as BookmarkIcon, ExternalLink, FolderOpen, Hash, LogOut, Plug, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../lib/storage'
import { toast } from '../state/store'
import {
  burrowLinks,
  burrowTags,
  collections,
  connect,
  disconnect,
  domainOf,
  dragBookmark,
  listBookmarks,
  useBurrow,
  useBurrowData,
  type Bookmark,
} from './api'

/**
 * Burrow in BrainWaves: connecting it, the side panel (browse, search, drag bookmarks into
 * pages and onto the canvas), and the picker the `/burrow` command opens.
 */

/** The address and token form (Burrow: Settings → New token). */
export function ConnectBurrow({ compact }: { compact?: boolean }) {
  const [url, setUrl] = useState('https://')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connect(url, token)
      toast('Burrow connected')
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={`bw-connect ${compact ? 'compact' : ''}`} onSubmit={go}>
      <p className="bw-hint">
        Connect your <b>Burrow</b> to use your bookmarks here. In Burrow, open <b>Settings → New token</b>, then paste its address and the token.
      </p>
      <label>
        Burrow address
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://burrow.example.com" required />
      </label>
      <label>
        API token
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="from Burrow → Settings → New token" required />
      </label>
      {error && <p className="bw-error">{error}</p>}
      <button className="bw-btn primary" disabled={busy}>
        <Plug size={13} /> {busy ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  )
}

function BookmarkRow({ b, base, onPick }: { b: Bookmark; base: string; onPick?: (b: Bookmark) => void }) {
  return (
    <li
      className="bw-row"
      draggable
      onDragStart={(e) => dragBookmark(e, b)}
      onClick={() => (onPick ? onPick(b) : b.url && void openExternal(b.url))}
      title={onPick ? 'Insert it' : 'Drag into a page or onto a canvas; click to open'}
    >
      <span className="bw-fav">{b.favicon ? <img src={b.favicon} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <BookmarkIcon size={14} />}</span>
      <span className="bw-text">
        <b>{b.title || b.url || 'Untitled'}</b>
        <small>
          {b.type === 'note' ? 'Note' : domainOf(b.url)}
          {b.tags.length > 0 && ` · ${b.tags.slice(0, 3).map((t) => '#' + t.name).join(' ')}`}
        </small>
      </span>
      {!onPick && (
        <span className="bw-row-actions" onClick={(e) => e.stopPropagation()}>
          <button title="See it in Burrow" onClick={() => void openExternal(burrowLinks(base, b).item)}>
            <ExternalLink size={12} />
          </button>
          {!!b.has_archive && (
            <button title="Archived copy" onClick={() => void openExternal(burrowLinks(base, b).archive)}>
              <Archive size={12} />
            </button>
          )}
        </span>
      )}
    </li>
  )
}

/** Search, tag and collection filters, and the results (used by the panel and the picker). */
function Browser({ onPick, autoFocus }: { onPick?: (b: Bookmark) => void; autoFocus?: boolean }) {
  const conn = useBurrow()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [coll, setColl] = useState<string>('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const tags = useBurrowData(conn ? burrowTags : null, [conn?.url])
  const cols = useBurrowData(conn ? collections : null, [conn?.url])
  const list = useBurrowData(conn ? () => listBookmarks({ ...(debounced ? { q: debounced } : {}), ...(tag ? { tag } : {}), ...(coll ? { collection: coll } : {}) }) : null, [conn?.url, debounced, tag, coll])
  if (!conn) return null
  return (
    <div className="bw-browser">
      <label className="bw-search">
        <Search size={13} />
        <input autoFocus={autoFocus} placeholder="Search Burrow (#tag works too)" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button aria-label="Clear" onClick={() => setQ('')}>
            <X size={12} />
          </button>
        )}
      </label>
      <div className="bw-filters">
        {!!cols.data?.length && (
          <label className="bw-coll">
            <FolderOpen size={12} />
            <select value={coll} onChange={(e) => setColl(e.target.value)}>
              <option value="">All collections</option>
              {cols.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="bw-tags">
          {(tags.data ?? [])
            .filter((t) => (t.count ?? 0) > 0)
            .slice(0, 24)
            .map((t) => (
              <button key={t.name} className={tag === t.name ? 'on' : ''} onClick={() => setTag(tag === t.name ? null : t.name)}>
                <Hash size={10} />
                {t.name}
              </button>
            ))}
        </div>
      </div>
      {list.error && <p className="bw-error">{list.error}</p>}
      {list.loading && !list.data && <p className="bw-hint">Loading…</p>}
      <ul className="bw-list">
        {(list.data?.items ?? []).map((b) => (
          <BookmarkRow key={b.id} b={b} base={conn.url} onPick={onPick} />
        ))}
      </ul>
      {list.data && list.data.items.length === 0 && <p className="bw-hint">Nothing in Burrow matches.</p>}
    </div>
  )
}

/** The sidebar's Burrow view. */
export function BurrowPanel() {
  const conn = useBurrow()
  return (
    <div className="bw-panel">
      <div className="sidebar-heading">
        <span>🦫 Burrow</span>
        {conn && (
          <span className="bw-head-actions">
            <button title={`Open ${conn.url}`} onClick={() => void openExternal(conn.url)}>
              <ExternalLink size={13} />
            </button>
            <button title="Disconnect Burrow" onClick={() => confirm('Disconnect Burrow? Cards in your pages stay, and come back when you connect again.') && void disconnect()}>
              <LogOut size={13} />
            </button>
          </span>
        )}
      </div>
      {conn === undefined ? null : conn ? (
        <>
          <p className="bw-hint">Drag a bookmark into a page or onto a canvas. Type /burrow in a page to search here.</p>
          <Browser />
        </>
      ) : (
        <ConnectBurrow />
      )}
    </div>
  )
}

// ---- the picker (for /burrow)

let request: { onPick: (b: Bookmark) => void } | null = null
const subs = new Set<() => void>()
const setRequest = (r: typeof request) => ((request = r), subs.forEach((l) => l()))
export const pickBookmark = (onPick: (b: Bookmark) => void) => setRequest({ onPick })

export function BurrowPickerHost() {
  const r = useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => request)
  const conn = useBurrow()
  const box = useRef<HTMLDivElement>(null)
  const close = () => setRequest(null)
  const content = useMemo(
    () =>
      r && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="bw-picker" ref={box} role="dialog" aria-label="Insert a bookmark from Burrow">
            <header>
              <span>🦫 Insert from Burrow</span>
              <button className="icon-button" aria-label="Close" onClick={close}>
                <X size={15} />
              </button>
            </header>
            {conn ? (
              <Browser
                autoFocus
                onPick={(b) => {
                  r.onPick(b)
                  close()
                }}
              />
            ) : (
              <ConnectBurrow compact />
            )}
          </div>
        </div>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, conn],
  )
  return content ? createPortal(content, document.body) : null
}
