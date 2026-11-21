import { ChevronRight, Image as ImageIcon, Move, Palette, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type * as Y from 'yjs'
import type { Page } from '../lib/types'
import { ancestors, childrenOf, openPage } from '../state/actions'
import { toast, useApp } from '../state/store'
import { backgroundCss, GRADIENTS, headerImage, removeHeader, safeImage, setHeader, textTone, type HeaderSettings, type Nav } from './model'

/**
 * A page's header: its background (gradient, color or picture), the icon, title and a subtitle
 * on it, placed and sized as set, and navigation (where the page is, and its sub-pages).
 */
export function PageHeader({ page, doc, h, icon, title, editable, wide }: { page: Page; doc: Y.Doc; h: HeaderSettings; icon: ReactNode; title: ReactNode; editable: boolean; wide?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const pages = useApp((s) => s.pages)
  const box = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; focus: number } | null>(null)
  const tone = textTone(h)
  const crumbs = h.nav === 'crumbs' || h.nav === 'both' ? ancestors(page.id).filter((p) => p.id !== page.id) : []
  const kids = h.nav === 'children' || h.nav === 'both' ? childrenOf(page.id).filter((p) => !p.trashedAt && !p.archived).slice(0, 12) : []
  void pages // re-render when titles change
  const isImage = h.background === 'image' && !!h.image

  // Reposition: drag the picture up or down.
  const onPointerDown = (e: React.PointerEvent) => {
    // The toolbar (Done) keeps working while repositioning.
    if (!moving || (e.target as HTMLElement).closest('.ph-tools')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, focus: h.focus }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !box.current) return
    const focus = Math.max(0, Math.min(100, d.focus - ((e.clientY - d.y) / box.current.clientHeight) * 100))
    setHeader(doc, { focus: Math.round(focus) })
  }

  return (
    <header
      ref={box}
      className={`ph ph-${h.align} ph-${h.place} ph-${tone} ${moving ? 'moving' : ''}`}
      style={{ height: h.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      data-testid="page-header"
    >
      {/* The background is clipped here, not on the header, so the editor panel can hang below it. */}
      <div className="ph-clip">
        <div className="ph-bg" style={{ ...backgroundCss(h), filter: h.blur && isImage ? `blur(${h.blur}px)` : undefined, transform: h.blur && isImage ? 'scale(1.06)' : undefined }} />
        {h.dim > 0 && <div className="ph-dim" style={{ opacity: h.dim }} />}
      </div>
      <div className={`ph-inner ${wide ? 'wide' : ''}`} style={{ ['--ph-title' as string]: h.titleScale }}>
        {crumbs.length > 0 && (
          <nav className="ph-crumbs" aria-label="Where this page is">
            {crumbs.map((p) => (
              <span key={p.id}>
                <button onClick={() => openPage(p.id)}>
                  {p.icon ? `${p.icon} ` : ''}
                  {p.title || 'Untitled'}
                </button>
                <ChevronRight size={12} />
              </span>
            ))}
          </nav>
        )}
        {h.showIcon && <div className="ph-icon">{icon}</div>}
        <div className="ph-title">{title}</div>
        {h.subtitle && <p className="ph-sub">{h.subtitle}</p>}
        {kids.length > 0 && (
          <nav className="ph-kids" aria-label="Sub-pages">
            {kids.map((p) => (
              <button key={p.id} onClick={() => openPage(p.id)}>
                {p.icon ? `${p.icon} ` : ''}
                {p.title || 'Untitled'}
              </button>
            ))}
          </nav>
        )}
      </div>
      {editable && (
        <div className="ph-tools">
          {moving ? (
            <button className="on" onClick={() => setMoving(false)}>
              Done
            </button>
          ) : (
            <>
              {isImage && (
                <button onClick={() => setMoving(true)} title="Drag the picture up or down">
                  <Move size={13} /> Reposition
                </button>
              )}
              <button onClick={() => setEditing((e) => !e)} className={editing ? 'on' : ''}>
                <Palette size={13} /> Edit header
              </button>
              <button title="Remove the header" aria-label="Remove the header" onClick={() => removeHeader(doc)}>
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      )}
      {moving && <div className="ph-moving-hint">Drag to reposition</div>}
      {editing && <HeaderEditor doc={doc} h={h} anchor={() => box.current?.querySelector<HTMLElement>('.ph-tools') ?? null} host={box.current?.closest<HTMLElement>('.editor-panel, .workspace') ?? document.body} close={() => setEditing(false)} />}
    </header>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  return (
    <div className="ph-seg">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void }) {
  return (
    <label className="ph-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <em>{show}</em>
    </label>
  )
}

/** The header's settings: background, layout, navigation. Changes show at once. */
function HeaderEditor({ doc, h, close, anchor, host }: { doc: Y.Doc; h: HeaderSettings; close: () => void; anchor: () => HTMLElement | null; host: HTMLElement }) {
  const [tab, setTab] = useState<'background' | 'layout' | 'nav'>('background')
  const [link, setLink] = useState(h.image.startsWith('http') ? h.image : '')
  const file = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const set = (p: Partial<HeaderSettings>) => setHeader(doc, p)
  // The panel floats over the page (not inside the header, which clips its background), under
  // the Edit header button, and never past the window's edge: it scrolls inside when it must.
  // On a phone it's a sheet at the bottom of the screen.
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor()?.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (vw <= 760 || !a) return setPos({ left: 8, right: 8, bottom: 8, maxHeight: Math.round(vh * 0.7) })
      const width = Math.min(360, vw - 24)
      const left = Math.max(12, Math.min(a.right - width, vw - width - 12))
      const below = vh - a.bottom - 20
      // Room under the button: open downwards. Too little (the header is near the bottom of
      // the window): open upwards instead.
      if (below >= 260 || below >= a.top) return setPos({ left, width, top: Math.round(a.bottom + 8), maxHeight: Math.round(below) })
      setPos({ left, width, bottom: Math.round(vh - a.top + 8), maxHeight: Math.round(a.top - 20) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (!panel.current?.contains(t) && !t.closest('.ph-tools')) close()
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [close])
  const upload = async (f: File) => {
    try {
      set({ background: 'image', image: await headerImage(f), focus: 50 })
    } catch (e) {
      toast(`Could not use the picture: ${String(e).replace(/^Error:\s*/, '')}`)
    }
  }
  return createPortal(
    <div className="ph-editor" ref={panel} style={pos} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && close())}>
      <div className="ph-editor-head">
        <Seg
          value={tab}
          options={[
            ['background', 'Background'],
            ['layout', 'Layout'],
            ['nav', 'Navigation'],
          ]}
          onChange={setTab}
        />
        <button className="ph-x" aria-label="Close" onClick={close}>
          <X size={14} />
        </button>
      </div>

      {tab === 'background' && (
        <div className="ph-editor-body">
          <Seg
            value={h.background}
            options={[
              ['gradient', 'Gradient'],
              ['color', 'Color'],
              ['image', 'Picture'],
            ]}
            onChange={(background) => set({ background })}
          />
          {h.background === 'gradient' && (
            <>
              <div className="ph-presets">
                {GRADIENTS.map((g) => (
                  <button
                    key={g.name}
                    title={g.name}
                    aria-label={`Gradient ${g.name}`}
                    className={g.colors.join() === h.colors.join() ? 'on' : ''}
                    style={{ background: `linear-gradient(${g.angle}deg, ${g.colors.join(', ')})` }}
                    onClick={() => set({ colors: g.colors, angle: g.angle })}
                  />
                ))}
              </div>
              <div className="ph-row">
                {h.colors.map((c, i) => (
                  <input key={i} type="color" value={c} aria-label={`Color ${i + 1}`} onChange={(e) => set({ colors: h.colors.map((x, j) => (j === i ? e.target.value : x)) })} />
                ))}
                {h.colors.length < 3 ? (
                  <button className="ph-mini" onClick={() => set({ colors: [...h.colors, '#ffffff'] })}>
                    + color
                  </button>
                ) : (
                  <button className="ph-mini" onClick={() => set({ colors: h.colors.slice(0, 2) })}>
                    − color
                  </button>
                )}
              </div>
              <Slider label="Angle" value={h.angle} min={0} max={360} step={5} show={`${h.angle}°`} onChange={(angle) => set({ angle })} />
            </>
          )}
          {h.background === 'color' && (
            <div className="ph-row">
              <input type="color" value={h.color} aria-label="Background color" onChange={(e) => set({ color: e.target.value })} />
              {['#1f2430', '#2b2f3a', '#3d2b56', '#123c3a', '#5b2333', '#f4efe6', '#e8f1f8', '#fff4d6'].map((c) => (
                <button key={c} className="ph-dot" style={{ background: c }} aria-label={`Color ${c}`} onClick={() => set({ color: c })} />
              ))}
            </div>
          )}
          {h.background === 'image' && (
            <>
              <div className="ph-row">
                <button className="ph-btn" onClick={() => file.current?.click()}>
                  <ImageIcon size={13} /> Upload a picture
                </button>
                <input
                  ref={file}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void upload(f)
                  }}
                />
              </div>
              <div className="ph-row">
                <input className="ph-input" placeholder="…or paste a picture's address (https://…)" value={link} onChange={(e) => setLink(e.target.value)} />
                <button
                  className="ph-btn"
                  onClick={() => {
                    const img = safeImage(link.trim())
                    if (!img) return toast('That needs to be an http(s) address of a picture')
                    set({ background: 'image', image: img, focus: 50 })
                  }}
                >
                  Use
                </button>
              </div>
              {!h.image && <p className="ph-hint">No picture yet.</p>}
              <Slider label="Blur" value={h.blur} min={0} max={12} step={1} show={`${h.blur}px`} onChange={(blur) => set({ blur })} />
            </>
          )}
          <Slider label="Darken" value={h.dim} min={0} max={0.8} step={0.05} show={`${Math.round(h.dim * 100)}%`} onChange={(dim) => set({ dim })} />
        </div>
      )}

      {tab === 'layout' && (
        <div className="ph-editor-body">
          <div className="ph-label">Height</div>
          <Seg
            value={h.height <= 170 ? 's' : h.height <= 270 ? 'm' : h.height <= 380 ? 'l' : 'xl'}
            options={[
              ['s', 'Small'],
              ['m', 'Medium'],
              ['l', 'Large'],
              ['xl', 'Tall'],
            ]}
            onChange={(v) => set({ height: { s: 160, m: 240, l: 340, xl: 460 }[v] })}
          />
          <Slider label="" value={h.height} min={100} max={640} step={10} show={`${h.height}px`} onChange={(height) => set({ height })} />
          <div className="ph-label">Title</div>
          <Seg
            value={h.align}
            options={[
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right'],
            ]}
            onChange={(align) => set({ align })}
          />
          <Seg
            value={h.place}
            options={[
              ['top', 'Top'],
              ['middle', 'Middle'],
              ['bottom', 'Bottom'],
            ]}
            onChange={(place) => set({ place })}
          />
          <Slider label="Title size" value={h.titleScale} min={0.6} max={1.8} step={0.05} show={`${Math.round(h.titleScale * 100)}%`} onChange={(titleScale) => set({ titleScale })} />
          <div className="ph-label">Text</div>
          <Seg
            value={h.text}
            options={[
              ['auto', 'Automatic'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            onChange={(text) => set({ text })}
          />
          <label className="ph-check">
            <input type="checkbox" checked={h.showIcon} onChange={(e) => set({ showIcon: e.target.checked })} /> Show the page's icon
          </label>
          <label className="ph-field">
            Subtitle
            <input className="ph-input" maxLength={300} defaultValue={h.subtitle} placeholder="A line under the title" onChange={(e) => set({ subtitle: e.target.value })} />
          </label>
        </div>
      )}

      {tab === 'nav' && (
        <div className="ph-editor-body">
          <p className="ph-hint">Links on the header to move around from this page.</p>
          {(
            [
              ['crumbs', 'Breadcrumbs', 'The pages this one is in, as a path above the title'],
              ['children', 'Sub-pages', 'This page’s sub-pages, as links under the title'],
              ['both', 'Both', 'The path above, sub-pages below'],
              ['none', 'None', 'Just the title'],
            ] as [Nav, string, string][]
          ).map(([v, label, desc]) => (
            <label key={v} className={`ph-radio ${h.nav === v ? 'on' : ''}`}>
              <input type="radio" name="ph-nav" checked={h.nav === v} onChange={() => set({ nav: v })} />
              <span>
                <b>{label}</b>
                <small>{desc}</small>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>,
    // Inside the editor panel, so the app's and the page's theme still apply to it.
    host,
  )
}
