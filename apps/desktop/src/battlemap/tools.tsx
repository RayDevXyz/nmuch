import { Circle, Pentagon, Spline, Square } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { Light, WallEl } from '../edgeless/model'
import { FLOORS, OPENINGS, TERRAIN } from './model'

/**
 * The battle map's drawing tools and their options: the shape a room or patch is drawn with,
 * its material, the brush width, which opening the door tool places, and which light.
 */

export type MapTool = 'room' | 'carve' | 'paint' | 'wall' | 'door' | 'light'
export const MAP_TOOLS: MapTool[] = ['room', 'carve', 'paint', 'wall', 'door', 'light']
export const isMapTool = (t: string): t is MapTool => (MAP_TOOLS as string[]).includes(t)

export type DrawShape = 'rect' | 'ellipse' | 'poly' | 'path'

export interface ToolOptions {
  shape: DrawShape
  floor: string
  terrain: string
  /** Brush width in grid squares. */
  brush: number
  opening: NonNullable<WallEl['kind']>
  light: string
  /** Snap shapes to the grid. */
  snap: boolean
}

export const LIGHT_PRESETS: Record<string, { label: string; light: Light }> = {
  torch: { label: 'Torch', light: { bright: 20, dim: 20, color: '#ffb35c', flicker: true } },
  candle: { label: 'Candle', light: { bright: 5, dim: 5, color: '#ffc979', flicker: true } },
  lantern: { label: 'Lantern', light: { bright: 30, dim: 30, color: '#ffd28a' } },
  bullseye: { label: 'Bullseye lantern', light: { bright: 60, dim: 60, color: '#ffe3ad', cone: { dir: 0, angle: 60 } } },
  brazier: { label: 'Brazier / campfire', light: { bright: 20, dim: 20, color: '#ff8c3a', flicker: true } },
  magic: { label: 'Magic light', light: { bright: 20, dim: 20, color: '#9fd0ff' } },
  eerie: { label: 'Eerie glow', light: { bright: 10, dim: 20, color: '#8cff9e', flicker: true } },
  daylight: { label: 'Daylight (spell)', light: { bright: 60, dim: 60, color: '#fff6dd' } },
}

const KEY = 'bw.mapTools'
let state: ToolOptions = { shape: 'rect', floor: 'stone', terrain: 'water', brush: 1, opening: 'door', light: 'torch', snap: true }
try {
  state = { ...state, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
} catch {
  /* defaults */
}
const listeners = new Set<() => void>()
export const getToolOptions = () => state
export function setToolOptions(patch: Partial<ToolOptions>) {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* not remembered */
  }
  listeners.forEach((l) => l())
}
export const useToolOptions = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )

const SHAPES: { id: DrawShape; label: string; icon: typeof Square }[] = [
  { id: 'rect', label: 'Rectangle: drag', icon: Square },
  { id: 'ellipse', label: 'Ellipse: drag', icon: Circle },
  { id: 'poly', label: 'Polygon: click the corners, double-click (or Enter) to finish', icon: Pentagon },
  { id: 'path', label: 'Brush: drag to paint a corridor, river or path', icon: Spline },
]

/** What the active map tool does, and its options: shown above the toolbar. */
export function ToolOptionsBar({ tool }: { tool: MapTool }) {
  const o = useToolOptions()
  const shaped = tool === 'room' || tool === 'carve' || tool === 'paint'
  return (
    <div className="bm-options" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <span className="bm-options-what">{HINT[tool]}</span>
      {shaped && (
        <span className="bm-seg" role="group" aria-label="Shape">
          {SHAPES.map((s) => (
            <button key={s.id} className={o.shape === s.id ? 'on' : ''} title={s.label} aria-label={s.label} aria-pressed={o.shape === s.id} onClick={() => setToolOptions({ shape: s.id })}>
              <s.icon size={14} />
            </button>
          ))}
        </span>
      )}
      {shaped && o.shape === 'path' && (
        <label className="bm-field" title="Brush width in squares">
          Width
          <select value={o.brush} onChange={(e) => setToolOptions({ brush: Number(e.target.value) })}>
            {[0.5, 1, 2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n} sq
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'room' && (
        <label className="bm-field">
          Floor
          <select value={o.floor} onChange={(e) => setToolOptions({ floor: e.target.value })}>
            {Object.entries(FLOORS).map(([id, m]) => (
              <option key={id} value={id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'paint' && (
        <label className="bm-field">
          Terrain
          <select value={o.terrain} onChange={(e) => setToolOptions({ terrain: e.target.value })}>
            {Object.entries(TERRAIN).map(([id, m]) => (
              <option key={id} value={id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'door' && (
        <label className="bm-field">
          Place
          <select value={o.opening} onChange={(e) => setToolOptions({ opening: e.target.value as ToolOptions['opening'] })}>
            {OPENINGS.filter((x) => x.kind !== 'wall').map((x) => (
              <option key={x.kind} value={x.kind}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'light' && (
        <label className="bm-field">
          Light
          <select value={o.light} onChange={(e) => setToolOptions({ light: e.target.value })}>
            {Object.entries(LIGHT_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(shaped || tool === 'wall') && (
        <label className="bm-check" title="Snap corners to the grid (hold Ctrl to draw freely)">
          <input type="checkbox" checked={o.snap} onChange={(e) => setToolOptions({ snap: e.target.checked })} /> snap
        </label>
      )}
    </div>
  )
}

const HINT: Record<MapTool, string> = {
  room: 'Room: add floor (overlapping rooms merge)',
  carve: 'Carve: cut floor away',
  paint: 'Terrain: paint the ground',
  wall: 'Wall: click the corners, double-click to finish',
  door: 'Opening: click on a wall',
  light: 'Light: click where it shines from',
}
