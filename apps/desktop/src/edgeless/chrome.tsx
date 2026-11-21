import { Maximize, Minus, Play, Plus, Redo2, Undo2 } from 'lucide-react'

export type Tool = 'select' | 'hand' | 'note' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'connector' | 'frame' | 'image' | 'pin' | 'token' | 'reveal'

const MIN_Z = 0.1
const MAX_Z = 4
// The slider runs on a log scale, so 10%–400% feels even.
const toSlider = (z: number) => Math.round((Math.log(z / MIN_Z) / Math.log(MAX_Z / MIN_Z)) * 100)
const fromSlider = (v: number) => MIN_Z * Math.pow(MAX_Z / MIN_Z, v / 100)

/** Bottom right: undo and redo, the zoom slider, fit, and presenting frames. */
export function ZoomBar({
  z,
  onZoomTo,
  onZoom,
  onFit,
  onUndo,
  onRedo,
  frames,
  onPresent,
}: {
  z: number
  onZoomTo: (z: number) => void
  onZoom: (f: number) => void
  onFit: () => void
  onUndo: () => void
  onRedo: () => void
  frames: number
  onPresent: () => void
}) {
  return (
    <div className="cv-zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button aria-label="Undo" title="Undo (Ctrl Z)" onClick={onUndo}>
        <Undo2 size={14} />
      </button>
      <button aria-label="Redo" title="Redo (Ctrl Shift Z)" onClick={onRedo}>
        <Redo2 size={14} />
      </button>
      <span className="cv-sep" />
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
