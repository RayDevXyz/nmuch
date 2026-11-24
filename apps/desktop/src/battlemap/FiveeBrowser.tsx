import { ChevronLeft, Grid3x3, Map as MapIcon, Search, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../state/store'
import { creatureArt, getImageSource, itemArt, mapBooks, mapsIn, picture, setImageSource, tokens, type MapBook, type Pic, type PicKind } from './fivee-art'

/**
 * Your 5etools' pictures in the prop library: monster tokens (a click places the monster, or
 * gives the selected token its picture), creature and item art (as props), and the maps in your
 * adventures and books (as the map's picture, its grid lined up with the battle map's).
 */

export interface FiveeActions {
  token: (p: Pic) => Promise<void>
  art: (p: Pic) => Promise<void>
  map: (p: Pic) => Promise<void>
  /** A token is selected: a token picture goes on it. */
  tokenSelected: boolean
}

const KINDS: { id: PicKind; label: string }[] = [
  { id: 'token', label: 'Tokens' },
  { id: 'creature', label: 'Creature art' },
  { id: 'item', label: 'Item art' },
  { id: 'map', label: 'Maps' },
]
const PAGE = 120

export function FiveeBrowser({ actions }: { actions: FiveeActions }) {
  const [kind, setKind] = useState<PicKind>('token')
  const [q, setQ] = useState('')
  const [list, setList] = useState<Pic[] | null>(null)
  const [error, setError] = useState('')
  const [books, setBooks] = useState<MapBook[] | null>(null)
  const [book, setBook] = useState<MapBook | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [busy, setBusy] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    let live = true
    setError('')
    setList(null)
    setLimit(PAGE)
    const load = kind === 'token' ? tokens() : kind === 'creature' ? creatureArt() : kind === 'item' ? itemArt() : book ? mapsIn(book) : null
    if (kind === 'map' && !book)
      void mapBooks().then(
        (b) => live && setBooks(b),
        (e) => live && setError(String(e)),
      )
    load?.then(
      (l) => live && setList(l),
      (e) => live && setError(String(e).replace(/^Error:\s*/, '')),
    )
    return () => {
      live = false
    }
  }, [kind, book])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = useMemo(() => (list ?? []).filter((p) => words.every((w) => p.name.toLowerCase().includes(w) || p.source.toLowerCase() === w)), [list, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (p: Pic, f: (p: Pic) => Promise<void>) => {
    setBusy(p.key)
    try {
      await f(p)
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bm-fivee">
      <div className="bm-cats">
        {KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => (setKind(k.id), setBook(null))}>
            {k.label}
          </button>
        ))}
        <button className={settings ? 'on' : ''} aria-label="Where the pictures are" title="Where the pictures are" onClick={() => setSettings(!settings)}>
          <Settings2 size={12} />
        </button>
      </div>
      {settings && <ImageSourceForm onDone={() => setSettings(false)} />}
      {kind === 'map' && book && (
        <button className="bm-back" onClick={() => setBook(null)}>
          <ChevronLeft size={13} /> {book.name}
        </button>
      )}
      {(kind !== 'map' || book) && (
        <label className="bm-search">
          <Search size={13} />
          <input placeholder={kind === 'map' ? 'Search maps…' : 'Search by name or book (MM, VGM…)'} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {error && <p className="sc-hint bm-error">{error}</p>}
      {kind === 'token' && !error && <p className="sc-hint">{actions.tokenSelected ? 'Click a picture to give the selected token its face.' : 'Click to place the monster, with its hit points, AC and size. Select a token first to give it a picture instead.'}</p>}
      {kind === 'map' && !book && (
        <ul className="bm-books">
          {books === null && !error && <li className="sc-hint">Reading your adventures and books…</li>}
          {books?.length === 0 && <li className="sc-hint">No adventures or books (or none turned on in the compendium’s settings).</li>}
          {books?.map((b) => (
            <li key={b.id}>
              <button onClick={() => (setBook(b), setQ(''))}>
                <MapIcon size={13} /> <span>{b.name}</span> <small>{b.id}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(kind !== 'map' || book) && list === null && !error && <p className="sc-hint">Reading your 5etools…</p>}
      {list && !shown.length && <p className="sc-hint">{list.length ? 'Nothing matches.' : kind === 'map' ? 'No maps in this one.' : 'None of your books has these pictures.'}</p>}
      {kind === 'map' ? (
        <ul className="bm-maps">
          {shown.slice(0, limit).map((p) => (
            <li key={p.key}>
              <button disabled={busy === p.key} onClick={() => void run(p, actions.map)} title="Put it on this battle map, its grid lined up">
                <Thumb path={p.path} />
                <span className="bm-map-text">
                  <b>{p.name}</b>
                  <small>
                    {p.map?.player ? 'Players’ version · ' : ''}
                    {p.map?.grid ? (
                      <>
                        <Grid3x3 size={10} /> {p.map.grid.type?.startsWith('hex') ? 'hexes' : 'squares'} of {p.map.grid.size} px
                      </>
                    ) : (
                      'no grid given'
                    )}
                  </small>
                  {busy === p.key && <small>Adding…</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="bm-grid">
          {shown.slice(0, limit).map((p) => (
            <div
              key={p.key}
              className={`bm-tile ${busy === p.key ? 'busy' : ''}`}
              role="button"
              tabIndex={0}
              title={`${p.name} (${p.source})`}
              onClick={() => void run(p, p.kind === 'token' ? actions.token : actions.art)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), void run(p, p.kind === 'token' ? actions.token : actions.art))}
            >
              <Thumb path={p.path} round={p.kind === 'token'} />
              <span className="bm-tile-name">{p.name}</span>
            </div>
          ))}
        </div>
      )}
      {shown.length > limit && (
        <button className="bm-upload" onClick={() => setLimit(limit + PAGE)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </div>
  )
}

/** A picture loaded from 5etools once it scrolls into view. */
function Thumb({ path, round }: { path: string; round?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    const io = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) return
      io.disconnect()
      picture(path).then(
        (s) => live && setSrc(s),
        () => live && setFailed(true),
      )
    })
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [path])
  return (
    <span ref={ref} className={`bm-thumb ${round ? 'round' : ''} ${failed ? 'failed' : ''}`} title={failed ? `Not found among your pictures: img/${path}` : undefined}>
      {src && <img src={src} alt="" draggable={false} />}
    </span>
  )
}

/** Where 5etools' pictures are: under the site (img/), or a separate address. */
function ImageSourceForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => void getImageSource().then((u) => setUrl(u ?? ''), () => {}), [])
  return (
    <div className="bm-imgsrc">
      <label>
        Pictures address
        <input placeholder="Empty: the img/ folder of your 5etools" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <p className="sc-hint">Where 5etools’ img folder is served (for example http://192.168.1.20:5050/img/). Leave it empty if the pictures are inside your 5etools site.</p>
      <button
        className="bm-upload"
        onClick={() =>
          void setImageSource(url).then(
            () => (toast('Saved: pictures come from there now'), onDone()),
            (e) => toast(String(e).replace(/^Error:\s*/, '')),
          )
        }
      >
        Save
      </button>
    </div>
  )
}
