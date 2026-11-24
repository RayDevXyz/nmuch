import { Film, Search, Star, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { DRAG_TYPE } from '../edgeless/SidePanel'
import { toast } from '../state/store'
import { ACCEPT, addToLibrary, libraryOf, readAsset, removeFromLibrary, useAssets, type Asset } from './assets'
import { BUILTIN, builtinSrc, CATEGORIES, favourites, toggleFavourite, type PropCategory } from './props'

/**
 * The battle map's prop library in the right panel: the built-in props by category, your own
 * uploads (the campaign's library), search over names and tags, and favourites. Click a prop to
 * put it in the middle of the view, or drag it onto the map. Drop files here to upload them.
 */
export function PropsLibrary({ doc, campaign, onAdd }: { doc: Y.Doc; campaign: string | null; onAdd: (asset: string) => void }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<PropCategory | 'all' | 'fav' | 'mine'>('all')
  const [fav, setFav] = useState(favourites)
  const [lib, setLib] = useState<Record<string, Asset>>({})
  const [over, setOver] = useState(false)
  const own = useAssets(doc)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let live = true
    void libraryOf(campaign).then((l) => live && setLib(l))
    return () => {
      live = false
    }
  }, [campaign, own])
  const mine = useMemo(() => Object.values({ ...lib, ...own }).sort((a, b) => b.at - a.at), [lib, own])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (name: string, tags: string[]) => words.every((w) => name.toLowerCase().includes(w) || tags.some((t) => t.startsWith(w)))
  const builtins = BUILTIN.filter((p) => (cat === 'all' || cat === p.cat || (cat === 'fav' && fav.has(`b:${p.id}`))) && match(p.label, p.tags))
  const uploads = mine.filter((a) => (cat === 'all' || cat === 'mine' || (cat === 'fav' && fav.has(`u:${a.hash}`))) && match(a.name, a.tags))

  const upload = async (files: File[]) => {
    for (const f of files) {
      try {
        const a = await readAsset(f)
        await addToLibrary(campaign, doc, a)
        setLib((l) => ({ ...l, [a.hash]: a }))
        toast(`${a.name} added to your props${a.animated ? ' (it moves)' : ''}`)
      } catch (e) {
        toast(String(e).replace(/^Error:\s*/, ''))
      }
    }
    setCat('mine')
  }
  const star = (asset: string) => setFav(new Set(toggleFavourite(asset)))

  const tile = (asset: string, label: string, src: string, opts: { video?: boolean; animated?: boolean; onRemove?: () => void } = {}) => (
    <div
      key={asset}
      className="bm-tile"
      role="button"
      tabIndex={0}
      title={`${label}: click to add, or drag onto the map`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, `prop:${asset}`)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onAdd(asset)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onAdd(asset))}
    >
      {opts.video ? <video src={src} muted autoPlay loop playsInline /> : <img src={src} alt="" draggable={false} />}
      <span className="bm-tile-name">{label}</span>
      {opts.animated && <Film className="bm-tile-anim" size={11} aria-label="moves" />}
      <button className={`bm-tile-star ${fav.has(asset) ? 'on' : ''}`} aria-label={fav.has(asset) ? `Unfavourite ${label}` : `Favourite ${label}`} onClick={(e) => (e.stopPropagation(), star(asset))}>
        <Star size={11} />
      </button>
      {opts.onRemove && (
        <button className="bm-tile-del" aria-label={`Remove ${label} from the library`} onClick={(e) => (e.stopPropagation(), opts.onRemove!())}>
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )

  return (
    <div
      className={`bm-library ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const files = [...e.dataTransfer.files]
        if (!files.length) return
        e.preventDefault()
        void upload(files)
      }}
    >
      <label className="bm-search">
        <Search size={13} />
        <input placeholder="Search props: barrel, light, trap…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="bm-cats">
        {(
          [
            ['all', 'All'],
            ['fav', '★ Favourites'],
            ['mine', 'Your uploads'],
            ...CATEGORIES.map((c) => [c.id, c.label]),
          ] as [typeof cat, string][]
        ).map(([id, label]) => (
          <button key={id} className={cat === id ? 'on' : ''} onClick={() => setCat(id)}>
            {label}
          </button>
        ))}
      </div>
      {(cat === 'mine' || cat === 'all') && (
        <button className="bm-upload" onClick={() => input.current?.click()}>
          <Upload size={14} /> Upload props <small>PNG, SVG, GIF, APNG, WebP, WebM · or drop files here</small>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void upload(files)
        }}
      />
      {uploads.length > 0 && (
        <>
          {cat === 'all' && <h4>Your uploads</h4>}
          <div className="bm-grid">
            {uploads.map((a) =>
              tile(`u:${a.hash}`, a.name, a.src, {
                video: a.video,
                animated: a.animated,
                onRemove: () => void removeFromLibrary(campaign, a.hash).then(() => setLib((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== a.hash)))),
              }),
            )}
          </div>
        </>
      )}
      {cat !== 'mine' &&
        CATEGORIES.filter((c) => builtins.some((p) => p.cat === c.id)).map((c) => (
          <div key={c.id}>
            <h4>{c.label}</h4>
            <div className="bm-grid">{builtins.filter((p) => p.cat === c.id).map((p) => tile(`b:${p.id}`, p.label, builtinSrc(p.id)))}</div>
          </div>
        ))}
      {!builtins.length && !uploads.length && <p className="sc-hint">{cat === 'fav' ? 'Star props to keep them here.' : cat === 'mine' ? 'Upload your own props: they’re kept with the campaign.' : 'Nothing matches.'}</p>}
    </div>
  )
}
