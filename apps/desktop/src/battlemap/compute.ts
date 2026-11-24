import type { AreaEl, Element, MapLayer } from '../edgeless/model'
import type { SceneSettings } from '../dnd/live'
import { areaGeometry, boundsOf, type Multi, type Seg } from './geom'
import { lights, vision, type LitSource, type Vision } from './lighting'
import { build, blockers, DEFAULT_LIGHTING, DEFAULT_MAP, layerOf, type Built, type LightingSettings, type MapSettings } from './model'

/** Everything a battle map's elements add up to, for the DM's view and for players. */
export interface MapState {
  map: MapSettings
  lighting: LightingSettings
  hidden: Set<MapLayer>
  locked: Set<MapLayer>
  built: Built
  carves: { id: string; geom: Multi }[]
  walls: Seg[]
  lit: LitSource[]
  vision: Vision | null
  /** The map's extent: pictures and everything drawn, with room for the walls' surroundings. */
  bounds: { x: number; y: number; w: number; h: number }
  /** Whether there is anything drawn (rather than only a picture). */
  drawn: boolean
}

export const mapSettings = (s: SceneSettings): MapSettings => ({ ...DEFAULT_MAP, ...s.map, layers: { ...DEFAULT_MAP.layers, ...s.map?.layers } })
export const lightingSettings = (s: SceneSettings): LightingSettings => ({ ...DEFAULT_LIGHTING, ...s.lighting })

/** The elements on layers that are shown. */
export function onShownLayers(elements: Element[], hidden: Set<MapLayer>) {
  return elements.filter((e) => e.visible !== false && !hidden.has(layerOf(e)))
}

export function computeMap(elements: Element[], settings: SceneSettings, withVision = true): MapState {
  const map = mapSettings(settings)
  const lighting = lightingSettings(settings)
  const hidden = new Set(map.layers.hidden)
  const locked = new Set(map.layers.locked)
  const shown = onShownLayers(elements, hidden)
  // The structure only changes when a shape or wall does: reuse it while tokens move.
  const structural = shown.filter((e) => e.type === 'area' || e.type === 'wall')
  const sig = JSON.stringify(structural)
  if (cache.sig !== sig) {
    const built = build(structural)
    cache.sig = sig
    cache.built = built
    cache.carves = structural.filter((e): e is AreaEl => e.type === 'area' && e.op === 'carve').map((a) => ({ id: a.id, geom: areaGeometry(a) }))
    cache.walls = blockers(built)
  }
  const { built, carves, walls } = cache as Required<typeof cache>
  const bounds = extent(shown, built, settings.grid.size)
  const g = { size: settings.grid.size, feet: settings.grid.feet }
  // Lights only change when a light (or its owner) moves or a wall does.
  const lightSig = sig + JSON.stringify(shown.filter((e) => e.type === 'light' || (e.type === 'prop' && (e.light || e.asset.startsWith('b:'))) || (e.type === 'token' && e.light)).map((e) => [e.id, 'xywh' in e ? e.xywh : null, 'light' in e ? e.light : null, e.rotate, e.layer, 'hidden' in e ? e.hidden : null, 'asset' in e ? e.asset : null])) + g.size + g.feet
  if (cache.lightSig !== lightSig) {
    cache.lightSig = lightSig
    cache.lit = lights(shown, walls, g, hidden as Set<string>)
  }
  const lit = cache.lit!
  const far = Math.hypot(bounds.w, bounds.h) + 200
  const v = withVision && lighting.vision ? vision(shown, walls, lit, lighting.ambient, g, far) : null
  const drawn = built.floor.length > 0 || built.terrain.length > 0 || built.walls.length > 0 || shown.some((e) => e.type === 'prop')
  return { map, lighting, hidden, locked, built, carves, walls, lit, vision: v, bounds, drawn }
}

const cache: { sig?: string; built?: Built; carves?: { id: string; geom: Multi }[]; walls?: Seg[]; lightSig?: string; lit?: LitSource[] } = {}

/** The map's extent. */
export function extent(elements: Element[], built: Built, grid: number): { x: number; y: number; w: number; h: number } {
  const boxes: { x: number; y: number; w: number; h: number }[] = []
  for (const e of elements) {
    if (e.type === 'image' || e.type === 'prop' || e.type === 'light') boxes.push({ x: e.xywh[0], y: e.xywh[1], w: e.xywh[2], h: e.xywh[3] })
  }
  for (const m of [built.floor, ...built.terrain.map((t) => t.geom)]) {
    const b = boundsOf(m)
    if (b) boxes.push(b)
  }
  for (const w of [...built.walls, ...built.openings]) {
    const xs = w.line.map((p) => p[0])
    const ys = w.line.map((p) => p[1])
    boxes.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
  }
  if (!boxes.length) return { x: -1400, y: -1000, w: 2800, h: 2000 }
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  // Only drawn maps need room around them (for hatching); a picture is its own edge.
  const pad = built.floor.length || built.walls.length || built.terrain.length ? grid * 1.5 : 0
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2), h: Math.ceil(y1 - y0 + pad * 2) }
}
