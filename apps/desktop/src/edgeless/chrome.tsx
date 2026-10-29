import {
  ArrowUpRight,
  Circle,
  Diamond,
  FileText,
  Frame,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Square,
  StickyNote,
  Trash2,
  Type,
} from 'lucide-react'
import { COLORS, type CanvasNote, type Element, type Rect, type ShapeKind } from './model'

export type Tool = 'select' | 'hand' | 'note' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'connector' | 'frame'

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: <MousePointer2 size={16} /> },
  { tool: 'hand', label: 'Pan (or hold Space)', key: 'H', icon: <Hand size={16} /> },
  { tool: 'note', label: 'Note', key: 'N', icon: <StickyNote size={16} /> },
  { tool: 'text', label: 'Text', key: 'T', icon: <Type size={16} /> },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={16} /> },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: <Circle size={16} /> },
  { tool: 'diamond', label: 'Diamond', key: 'D', icon: <Diamond size={16} /> },
  { tool: 'connector', label: 'Connector: drag from one item to another', key: 'C', icon: <ArrowUpRight size={16} /> },
  { tool: 'frame', label: 'Frame', key: 'F', icon: <Frame size={16} /> },
]

export function Toolbar({ tool, onTool, frames, onPresent }: { tool: Tool; onTool: (t: Tool) => void; frames: number; onPresent: () => void }) {
  return (
    <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`cv-tool ${tool === t.tool ? 'active' : ''}`}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.tool}
          onClick={() => onTool(t.tool)}
        >
          {t.icon}
        </button>
      ))}
      {frames > 0 && (
        <>
          <span className="cv-sep" />
          <button className="cv-tool" title="Present frames (← → to move, Esc to exit)" aria-label="Present" onClick={onPresent}>
            <Play size={16} />
          </button>
        </>
      )}
    </div>
  )
}

export function ZoomControls({ z, onZoom, onFit }: { z: number; onZoom: (f: number) => void; onFit: () => void }) {
  return (
    <div className="cv-zoom">
      <button aria-label="Zoom out" title="Zoom out (Ctrl -)" onClick={() => onZoom(0.8)}>
        <Minus size={14} />
      </button>
      <span className="cv-zoom-value">{Math.round(z * 100)}%</span>
      <button aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => onZoom(1.25)}>
        <Plus size={14} />
      </button>
      <button aria-label="Zoom to fit" title="Zoom to fit (Ctrl 1)" onClick={onFit}>
        <Maximize size={14} />
      </button>
    </div>
  )
}

const SIZES: [string, number][] = [
  ['S', 14],
  ['M', 20],
  ['L', 32],
]
const SHAPES: [ShapeKind, React.ReactNode][] = [
  ['rect', <Square size={14} key="r" />],
  ['ellipse', <Circle size={14} key="e" />],
  ['diamond', <Diamond size={14} key="d" />],
]

/** Floating bar above the selection: color, shape, size, and a note's "show in document". */
export function StyleBar({
  at,
  items,
  note,
  onStyle,
  onDisplay,
  onDelete,
}: {
  at: Rect
  items: Element[]
  note?: CanvasNote
  onStyle: (patch: Record<string, unknown>) => void
  onDisplay: (d: 'both' | 'edgeless') => void
  onDelete: () => void
}) {
  const shapes = items.filter((i) => i.type === 'shape')
  const texts = items.filter((i) => i.type === 'text')
  const current = items.length === 1 ? (items[0] as { fill?: string; color?: string; stroke?: string }) : null
  const currentColor = current?.fill ?? current?.color ?? current?.stroke
  return (
    <div className="cv-stylebar" style={{ left: at.x + at.w / 2, top: Math.max(8, at.y - 52) }} onPointerDown={(e) => e.stopPropagation()}>
      {items.length > 0 && (
        <div className="cv-colors">
          {Object.entries(COLORS).map(([name, hex]) => (
            <button
              key={name}
              className={`cv-swatch ${currentColor === name ? 'active' : ''}`}
              style={{ background: hex }}
              title={name}
              aria-label={`Color ${name}`}
              onClick={() => onStyle({ color: name })}
            />
          ))}
        </div>
      )}
      {shapes.length > 0 && (
        <>
          <span className="cv-sep" />
          {SHAPES.map(([kind, icon]) => (
            <button key={kind} className="cv-mini" title={kind} aria-label={`Shape ${kind}`} onClick={() => onStyle({ shape: kind })}>
              {icon}
            </button>
          ))}
        </>
      )}
      {texts.length > 0 && (
        <>
          <span className="cv-sep" />
          {SIZES.map(([label, size]) => (
            <button key={label} className="cv-mini" title={`${size}px`} onClick={() => onStyle({ fontSize: size })}>
              {label}
            </button>
          ))}
        </>
      )}
      {note && (
        <button
          className={`cv-doc-toggle ${note.display === 'both' ? 'on' : ''}`}
          title={note.display === 'both' ? 'Shown in the document too: click to keep it on the canvas only' : 'Canvas only: click to show it in the document too'}
          onClick={() => onDisplay(note.display === 'both' ? 'edgeless' : 'both')}
        >
          <FileText size={13} /> {note.display === 'both' ? 'In document' : 'Canvas only'}
        </button>
      )}
      <span className="cv-sep" />
      <button className="cv-mini danger" title="Delete (Del)" aria-label="Delete" onClick={onDelete}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}
