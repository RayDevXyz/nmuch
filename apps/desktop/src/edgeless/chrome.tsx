import {
  ArrowUpRight,
  Circle,
  CircleUserRound,
  CloudFog,
  Diamond,
  Frame,
  Hand,
  Image as ImageIcon,
  LayoutGrid,
  MapPin,
  Maximize,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { getState, setState, useApp } from '../state/store'

export type Tool = 'select' | 'hand' | 'note' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'connector' | 'frame' | 'image' | 'pin' | 'token' | 'reveal'

const MIN_Z = 0.1
const MAX_Z = 4
// The slider runs on a log scale, so 10%–400% feels even.
const toSlider = (z: number) => Math.round((Math.log(z / MIN_Z) / Math.log(MAX_Z / MIN_Z)) * 100)
const fromSlider = (v: number) => MIN_Z * Math.pow(MAX_Z / MIN_Z, v / 100)

/** Top right: zoom out and in, the zoom slider, fit, and presenting frames. */
export function ZoomBar({
  z,
  onZoomTo,
  onZoom,
  onFit,
  frames,
  onPresent,
}: {
  z: number
  onZoomTo: (z: number) => void
  onZoom: (f: number) => void
  onFit: () => void
  frames: number
  onPresent: () => void
}) {
  return (
    <div className="cv-zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button aria-label="Zoom out" title="Zoom out (Ctrl -)" onClick={() => onZoom(0.8)}>
        <Minus size={14} />
      </button>
      <input className="cv-zoom-slider" type="range" min={0} max={100} value={toSlider(z)} aria-label="Zoom" onChange={(e) => onZoomTo(fromSlider(Number(e.target.value)))} />
      <button aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => onZoom(1.25)}>
        <Plus size={14} />
      </button>
      <span className="cv-zoom-value">{Math.round(z * 100)}%</span>
      <button aria-label="Zoom to fit" title="Zoom to fit (Ctrl 1)" onClick={onFit}>
        <Maximize size={14} />
      </button>
      {frames > 0 && (
        <>
          <span className="cv-sep" />
          <button aria-label="Present" title="Present frames (← → to move, Esc to exit)" onClick={onPresent}>
            <Play size={14} />
          </button>
        </>
      )}
    </div>
  )
}

type ToolDef = { tool: Tool; label: string; key: string; icon: LucideIcon }

const GROUPS: ToolDef[][] = [
  [
    { tool: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
    { tool: 'hand', label: 'Pan (or hold Space)', key: 'H', icon: Hand },
  ],
  [
    { tool: 'note', label: 'Note', key: 'N', icon: StickyNote },
    { tool: 'text', label: 'Text', key: 'T', icon: Type },
    { tool: 'rect', label: 'Rectangle', key: 'R', icon: Square },
    { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle },
    { tool: 'diamond', label: 'Diamond', key: 'D', icon: Diamond },
    { tool: 'connector', label: 'Connector: drag from one item to another', key: 'C', icon: ArrowUpRight },
    { tool: 'frame', label: 'Frame', key: 'F', icon: Frame },
  ],
  [
    { tool: 'image', label: 'Picture: click where it goes', key: 'I', icon: ImageIcon },
    { tool: 'pin', label: 'Pin a page', key: 'P', icon: MapPin },
  ],
]
const SCENE: ToolDef[] = [
  { tool: 'token', label: 'Token: a character or monster', key: 'K', icon: CircleUserRound },
  { tool: 'reveal', label: 'Reveal: drag over an area to clear its fog', key: 'E', icon: CloudFog },
]

/**
 * Bottom centre: the drawing tools in one floating bar, and a button that shows the canvas's
 * assets (shapes, text, pictures, layers) in the right panel.
 */
export function CanvasToolbar({ tool, onTool, scene, onUndo, onRedo }: { tool: Tool; onTool: (t: Tool) => void; scene: boolean; onUndo: () => void; onRedo: () => void }) {
  const showing = useApp((s) => s.rightOpen && s.rightView === 'assets')
  const groups = scene ? [...GROUPS, SCENE] : GROUPS
  return (
    <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cv-toolbar-group">
        <button className="cv-tb" title="Undo (Ctrl Z)" aria-label="Undo" onClick={onUndo}>
          <Undo2 size={17} />
        </button>
        <button className="cv-tb" title="Redo (Ctrl Shift Z)" aria-label="Redo" onClick={onRedo}>
          <Redo2 size={17} />
        </button>
      </div>
      {groups.map((g, i) => (
        <div key={i} className="cv-toolbar-group">
          {g.map((t) => (
            <button key={t.tool} className={`cv-tb ${tool === t.tool ? 'on' : ''}`} title={`${t.label} (${t.key})`} aria-label={t.label} aria-pressed={tool === t.tool} onClick={() => onTool(t.tool)}>
              <t.icon size={17} />
            </button>
          ))}
        </div>
      ))}
      <div className="cv-toolbar-group">
        <button
          className={`cv-tb ${showing ? 'on' : ''}`}
          title={showing ? 'Hide the assets' : 'Assets: shapes, text, pictures and layers'}
          aria-label="Assets"
          aria-pressed={showing}
          onClick={() => {
            const s = getState()
            if (s.rightOpen && s.rightView === 'assets') setState({ rightOpen: false })
            else setState({ rightOpen: true, rightView: 'assets' })
          }}
        >
          <LayoutGrid size={17} />
        </button>
      </div>
    </div>
  )
}
