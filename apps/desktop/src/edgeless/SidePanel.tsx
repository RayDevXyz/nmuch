import {
  ArrowUpRight,
  Bookmark,
  CircleUserRound,
  CloudFog,
  Eye,
  EyeOff,
  Frame,
  Hand,
  Image as ImageIcon,
  Layers,
  Lock,
  MapPin,
  MousePointer2,
  Shapes,
  Spline,
  Square,
  StickyNote,
  Type,
  Unlock,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import type * as Y from 'yjs'
import { useApp } from '../state/store'
import type { Tool } from './chrome'
import { colorOf, fillOf, FONTS, placeAbove, updateElements, type CanvasNote, type Element, type NewElement } from './model'

/**
 * The canvas's side panel, like a design tool's: a rail of tabs, and a panel to add things from
 * (click to add in the middle of the view, or drag onto the canvas), the pictures you uploaded,
 * and the layers.
 */

export type PanelTab = 'elements' | 'text' | 'uploads' | 'layers'

/** Something the panel adds: an element (its size; placed where it's dropped), or a note. */
export interface Preset {
  id: string
  label: string
  make: () => NewElement | { note: true; w: number }
}

const shape = (id: string, label: string, s: 'rect' | 'ellipse' | 'diamond', fill: string, stroke: string, w = 160, h = 110, extra: Record<string, unknown> = {}): Preset => ({
  id,
  label,
  make: () => ({ type: 'shape', shape: s, xywh: [0, 0, w, h], fill, stroke, text: '', ...extra }) as NewElement,
})

export const PRESETS: Preset[] = [
  shape('rect', 'Rectangle', 'rect', 'blue', 'blue'),
  shape('ellipse', 'Ellipse', 'ellipse', 'green', 'green', 140, 140),
  shape('diamond', 'Diamond', 'diamond', 'yellow', 'yellow', 140, 140),
  shape('rect-solid', 'Solid block', 'rect', '#4f8fd8', 'none', 160, 110, { strokeWidth: 0, color: '#ffffff' }),
  shape('circle-solid', 'Solid circle', 'ellipse', '#e05a55', 'none', 120, 120, { strokeWidth: 0, color: '#ffffff' }),
  shape('outline', 'Outline', 'rect', 'none', 'gray', 160, 110),
  shape('pill', 'Label', 'rect', 'purple', 'purple', 180, 48, { fontSize: 16, bold: true }),
  shape('outline-circle', 'Ring', 'ellipse', 'none', 'orange', 120, 120, { strokeWidth: 4 }),
  { id: 'note', label: 'Note', make: () => ({ note: true, w: 360 }) },
  { id: 'frame-16x9', label: 'Slide 16:9', make: () => ({ type: 'frame', xywh: [0, 0, 1280, 720], text: 'Slide' }) },
  { id: 'frame-square', label: 'Square', make: () => ({ type: 'frame', xywh: [0, 0, 1080, 1080], text: 'Square' }) },
  { id: 'frame-a4', label: 'A4 page', make: () => ({ type: 'frame', xywh: [0, 0, 794, 1123], text: 'Page' }) },
  { id: 'frame-board', label: 'Board', make: () => ({ type: 'frame', xywh: [0, 0, 1600, 1000], text: 'Board' }) },
  { id: 'heading', label: 'Add a heading', make: () => ({ type: 'text', xywh: [0, 0, 520, 64], text: 'Add a heading', fontSize: 48, bold: true }) },
  { id: 'subheading', label: 'Add a subheading', make: () => ({ type: 'text', xywh: [0, 0, 420, 40], text: 'Add a subheading', fontSize: 28, bold: true }) },
  { id: 'body', label: 'Add a little bit of body text', make: () => ({ type: 'text', xywh: [0, 0, 360, 30], text: 'Add a little bit of body text', fontSize: 18 }) },
  { id: 'title-display', label: 'The Lost Mine', make: () => ({ type: 'text', xywh: [0, 0, 560, 70], text: 'The Lost Mine', fontSize: 52, fontFamily: 'display', align: 'center' }) },
  { id: 'title-serif', label: 'An elegant title', make: () => ({ type: 'text', xywh: [0, 0, 460, 60], text: 'An elegant title', fontSize: 42, fontFamily: 'serif', italic: true }) },
  { id: 'title-hand', label: 'A handwritten note', make: () => ({ type: 'text', xywh: [0, 0, 380, 44], text: 'A handwritten note', fontSize: 30, fontFamily: 'hand', color: 'orange' }) },
  { id: 'code', label: 'const answer = 42', make: () => ({ type: 'text', xywh: [0, 0, 320, 30], text: 'const answer = 42', fontSize: 18, fontFamily: 'mono' }) },
]
export const presetById = (id: string) => PRESETS.find((p) => p.id === id)
export const DRAG_TYPE = 'application/x-bw-preset'

/** Pictures uploaded this session, to add again. */
const recent: { src: string; w: number; h: number }[] = []
export const rememberUpload = (img: { src: string; w: number; h: number }) => {
  if (!recent.some((r) => r.src === img.src)) recent.unshift(img)
  recent.splice(12)
}

interface Props {
  tab?: PanelTab | null
  onTab?: (t: PanelTab | null) => void
  tool: Tool
  onTool: (t: Tool) => void
  scene: boolean
  onAdd: (p: Preset) => void
  onUpload: () => void
  onAddImage: (img: { src: string; w: number; h: number }) => void
  doc: Y.Doc
  elements: Element[]
  notes: CanvasNote[]
  selected: string[]
  onSelect: (ids: string[]) => void
  onFocus: (id: string) => void
}

const TABS: { id: PanelTab; label: string; icon: LucideIcon }[] = [
  { id: 'elements', label: 'Elements', icon: Shapes },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'uploads', label: 'Uploads', icon: Upload },
  { id: 'layers', label: 'Layers', icon: Layers },
]

const TOOLS: { tool: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { tool: 'hand', label: 'Pan (or hold Space)', key: 'H', icon: Hand },
  { tool: 'connector', label: 'Connector: drag from one item to another', key: 'C', icon: ArrowUpRight },
  { tool: 'note', label: 'Note', key: 'N', icon: StickyNote },
  { tool: 'text', label: 'Text', key: 'T', icon: Type },
  { tool: 'rect', label: 'Rectangle: drag to draw', key: 'R', icon: Square },
  { tool: 'frame', label: 'Frame', key: 'F', icon: Frame },
  { tool: 'image', label: 'Image: a map or picture, click where it goes', key: 'I', icon: ImageIcon },
  { tool: 'pin', label: 'Pin: mark a page on the map', key: 'P', icon: MapPin },
]
const SCENE_TOOLS: typeof TOOLS = [
  { tool: 'token', label: 'Token: a character or monster, click where it stands', key: 'K', icon: CircleUserRound },
  { tool: 'reveal', label: 'Reveal: drag over an area to clear its fog', key: 'E', icon: CloudFog },
]

const TAB_KEY = 'bw.canvasAssetsTab'

/**
 * The canvas's assets in the right panel: shapes, frames and notes; text styles; pictures; and the
 * layers. Click a tile to add it in the middle of the view, or drag it onto the canvas.
 */
export function AssetsPanel(p: Props) {
  const [tab, setTab] = useState<PanelTab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as PanelTab) || 'elements'
    } catch {
      return 'elements'
    }
  })
  const pick = (t: PanelTab) => {
    setTab(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* not remembered */
    }
  }
  return (
    <div className="cv-assets" onKeyDown={(e) => e.stopPropagation()}>
      <nav className="cv-assets-tabs" role="tablist" aria-label="Canvas assets">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)} title={t.label}>
            <t.icon size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="cv-drawer-body cv-assets-body">
        {tab === 'elements' && <ElementsTab {...p} />}
        {tab === 'text' && <TextTab {...p} />}
        {tab === 'uploads' && <UploadsTab {...p} />}
        {tab === 'layers' && <LayersTab {...p} />}
      </div>
    </div>
  )
}

/** A thing to click (adds it in the middle of the view) or drag onto the canvas. */
function Tile({ preset, onAdd, className, children, title }: { preset: Preset; onAdd: (p: Preset) => void; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <button
      className={`cv-tile ${className ?? ''}`}
      title={title ?? `${preset.label}: click to add, or drag onto the canvas`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, preset.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onAdd(preset)}
    >
      {children}
    </button>
  )
}

function ElementsTab(p: Props) {
  const tools = [...TOOLS.slice(3), ...(p.scene ? SCENE_TOOLS : [])]
  return (
    <>
      <h4>Draw</h4>
      <div className="cv-tool-grid">
        {tools.map((t) => (
          <button key={t.tool} className={`cv-tool wide ${p.tool === t.tool ? 'active' : ''}`} title={`${t.label} (${t.key})`} aria-label={t.label} onClick={() => p.onTool(t.tool)}>
            <t.icon size={16} />
            <span>{t.label.split(':')[0]}</span>
            <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <h4>Shapes</h4>
      <div className="cv-tiles">
        {PRESETS.filter((x) => x.make() && 'type' in x.make() && (x.make() as NewElement).type === 'shape').map((preset) => {
          const el = preset.make() as Extract<NewElement, { type: 'shape' }>
          const [, , w, h] = el.xywh
          const k = 54 / Math.max(w, h)
          const sw = Math.max(1.5, Math.min(4, (el.strokeWidth ?? 2) * 0.8))
          const fill = fillOf(el.fill)
          const stroke = el.stroke === 'none' || el.strokeWidth === 0 ? 'transparent' : colorOf(el.stroke)
          return (
            <Tile key={preset.id} preset={preset} onAdd={p.onAdd}>
              <svg width={w * k + 6} height={h * k + 6} viewBox={`-3 -3 ${w * k + 6} ${h * k + 6}`}>
                {el.shape === 'ellipse' ? (
                  <ellipse cx={(w * k) / 2} cy={(h * k) / 2} rx={(w * k) / 2} ry={(h * k) / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
                ) : el.shape === 'diamond' ? (
                  <polygon points={`${(w * k) / 2},0 ${w * k},${(h * k) / 2} ${(w * k) / 2},${h * k} 0,${(h * k) / 2}`} fill={fill} stroke={stroke} strokeWidth={sw} />
                ) : (
                  <rect width={w * k} height={h * k} rx={preset.id === 'pill' ? 12 : 5} fill={fill} stroke={stroke} strokeWidth={sw} />
                )}
              </svg>
            </Tile>
          )
        })}
      </div>
      <h4>Lines</h4>
      <div className="cv-tiles">
        <button className={`cv-tile ${p.tool === 'connector' ? 'on' : ''}`} title="Connector: drag from one item to another (C)" onClick={() => p.onTool('connector')}>
          <Spline size={30} />
        </button>
      </div>
      <h4>Frames</h4>
      <div className="cv-tiles frames">
        {PRESETS.filter((x) => x.id.startsWith('frame-')).map((preset) => {
          const el = preset.make() as Extract<NewElement, { type: 'frame' }>
          const [, , w, h] = el.xywh
          const k = 56 / Math.max(w, h)
          return (
            <Tile key={preset.id} preset={preset} onAdd={p.onAdd}>
              <span className="cv-frame-tile" style={{ width: w * k, height: h * k }} />
              <small>{preset.label}</small>
            </Tile>
          )
        })}
        <Tile preset={presetById('note')!} onAdd={p.onAdd}>
          <StickyNote size={26} />
          <small>Note</small>
        </Tile>
      </div>
    </>
  )
}

function TextTab(p: Props) {
  const main = ['heading', 'subheading', 'body'].map((id) => presetById(id)!)
  const combos = ['title-display', 'title-serif', 'title-hand', 'code'].map((id) => presetById(id)!)
  return (
    <>
      <button className="cv-wide-btn" onClick={() => p.onTool('text')}>
        <Type size={15} /> Add a text box <kbd>T</kbd>
      </button>
      <h4>Default text styles</h4>
      {main.map((preset) => {
        const el = preset.make() as Extract<NewElement, { type: 'text' }>
        return (
          <Tile key={preset.id} preset={preset} onAdd={p.onAdd} className="text-tile">
            <span style={{ fontSize: Math.min(26, (el.fontSize ?? 18) * 0.55 + 6), fontWeight: el.bold ? 700 : 400 }}>{preset.label}</span>
          </Tile>
        )
      })}
      <h4>Font combinations</h4>
      {combos.map((preset) => {
        const el = preset.make() as Extract<NewElement, { type: 'text' }>
        return (
          <Tile key={preset.id} preset={preset} onAdd={p.onAdd} className="text-tile">
            <span style={{ fontFamily: el.fontFamily ? FONTS[el.fontFamily].css : undefined, fontSize: 22, fontStyle: el.italic ? 'italic' : undefined, color: el.color ? colorOf(el.color) : undefined }}>{preset.label}</span>
          </Tile>
        )
      })}
    </>
  )
}

function UploadsTab(p: Props) {
  const onPage = p.elements.filter((e): e is Extract<Element, { type: 'image' }> => e.type === 'image')
  return (
    <>
      <button className="cv-wide-btn primary" onClick={p.onUpload}>
        <Upload size={15} /> Upload a picture
      </button>
      <p className="cv-drawer-hint">Or drop picture files straight onto the canvas.</p>
      {recent.length > 0 && (
        <>
          <h4>Uploaded this session</h4>
          <div className="cv-thumbs">
            {recent.map((r, i) => (
              <button key={i} className="cv-thumb" title="Add it again" onClick={() => p.onAddImage(r)}>
                <img src={r.src} alt="" />
              </button>
            ))}
          </div>
        </>
      )}
      <h4>On this page</h4>
      {onPage.length === 0 ? (
        <p className="cv-drawer-hint">No pictures yet.</p>
      ) : (
        <div className="cv-thumbs">
          {onPage.map((e) => (
            <button key={e.id} className={`cv-thumb ${p.selected.includes(e.id) ? 'on' : ''}`} title="Show it" onClick={() => p.onFocus(e.id)}>
              <img src={e.src} alt="" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}

const TYPE_LABEL: Record<Element['type'], string> = {
  shape: 'Shape',
  text: 'Text',
  connector: 'Connector',
  frame: 'Frame',
  image: 'Picture',
  pin: 'Pin',
  token: 'Token',
  reveal: 'Revealed area',
  bookmark: 'Bookmark',
}

function LayersTab(p: Props) {
  const pages = useApp((s) => s.pages)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Top of the list is the top of the stack.
  const items = p.elements.filter((e) => e.type !== 'frame').reverse()
  const frames = p.elements.filter((e) => e.type === 'frame')
  const name = (e: Element) => {
    if (e.type === 'pin') return pages[e.page]?.title || e.text || 'Pin'
    if (e.type === 'shape') return e.text?.trim() || `${e.shape === 'rect' ? 'Rectangle' : e.shape === 'ellipse' ? 'Ellipse' : 'Diamond'}`
    return e.text?.trim() || TYPE_LABEL[e.type]
  }
  const row = (e: Element, draggable: boolean) => {
    const on = p.selected.includes(e.id)
    return (
      <li
        key={e.id}
        className={`cv-layer ${on ? 'on' : ''} ${e.visible === false ? 'off' : ''} ${over === e.id ? 'drop' : ''}`}
        draggable={draggable && !e.locked}
        onDragStart={(ev) => (setDragging(e.id), ev.dataTransfer.setData('text/plain', e.id), (ev.dataTransfer.effectAllowed = 'move'))}
        onDragEnd={() => (setDragging(null), setOver(null))}
        onDragOver={(ev) => dragging && dragging !== e.id && draggable && (ev.preventDefault(), setOver(e.id))}
        onDrop={(ev) => {
          ev.preventDefault()
          if (dragging && dragging !== e.id) placeAbove(p.doc, dragging, e.id)
          setDragging(null)
          setOver(null)
        }}
        onClick={(ev) => p.onSelect(ev.shiftKey ? (on ? p.selected.filter((x) => x !== e.id) : [...p.selected, e.id]) : [e.id])}
        onDoubleClick={() => p.onFocus(e.id)}
      >
        <span className="cv-layer-thumb">
          {e.type === 'image' ? <img src={e.src} alt="" /> : <LayerIcon e={e} />}
        </span>
        <span className="cv-layer-name">
          {name(e)}
          {e.group && <small> · group</small>}
        </span>
        <button className="cv-icon" title={e.visible === false ? 'Show' : 'Hide'} aria-label={e.visible === false ? 'Show' : 'Hide'} onClick={(ev) => (ev.stopPropagation(), updateElements(p.doc, { [e.id]: { visible: e.visible === false ? undefined : false } }))}>
          {e.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button className={`cv-icon ${e.locked ? 'lit' : ''}`} title={e.locked ? 'Unlock' : 'Lock'} aria-label={e.locked ? 'Unlock' : 'Lock'} onClick={(ev) => (ev.stopPropagation(), updateElements(p.doc, { [e.id]: { locked: e.locked ? undefined : true } }))}>
          {e.locked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
      </li>
    )
  }
  return (
    <>
      <p className="cv-drawer-hint">Top of the list is in front. Drag to reorder; double-click to zoom to it.</p>
      {items.length === 0 && frames.length === 0 && <p className="cv-drawer-hint">Nothing on the canvas yet.</p>}
      <ul className="cv-layers">{items.map((e) => row(e, true))}</ul>
      {frames.length > 0 && (
        <>
          <h4>Frames (always at the back)</h4>
          <ul className="cv-layers">{frames.map((e) => row(e, false))}</ul>
        </>
      )}
      {p.notes.some((n) => n.xywh) && (
        <>
          <h4>Notes (always in front)</h4>
          <ul className="cv-layers">
            {p.notes
              .filter((n) => n.xywh)
              .map((n, i) => (
                <li key={n.id} className={`cv-layer ${p.selected.includes(n.id) ? 'on' : ''}`} onClick={() => p.onSelect([n.id])} onDoubleClick={() => p.onFocus(n.id)}>
                  <span className="cv-layer-thumb">
                    <StickyNote size={14} />
                  </span>
                  <span className="cv-layer-name">Note {i + 1}</span>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  )
}

function LayerIcon({ e }: { e: Element }) {
  if (e.type === 'shape') {
    const fill = fillOf(e.fill)
    const stroke = colorOf(e.stroke)
    return (
      <svg width="18" height="18" viewBox="0 0 18 18">
        {e.shape === 'ellipse' ? <ellipse cx="9" cy="9" rx="7.5" ry="7.5" fill={fill} stroke={stroke} /> : e.shape === 'diamond' ? <polygon points="9,1.5 16.5,9 9,16.5 1.5,9" fill={fill} stroke={stroke} /> : <rect x="1.5" y="3" width="15" height="12" rx="2" fill={fill} stroke={stroke} />}
      </svg>
    )
  }
  const Icon = ({ text: Type, connector: ArrowUpRight, frame: Frame, pin: MapPin, token: CircleUserRound, reveal: CloudFog, image: ImageIcon, bookmark: Bookmark } as Record<string, LucideIcon>)[e.type] ?? Square
  return <Icon size={14} />
}
