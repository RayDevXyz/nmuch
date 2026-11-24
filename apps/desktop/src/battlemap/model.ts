import type { AreaEl, Element, MapLayer, WallEl } from '../edgeless/model'
import { areaGeometry, edges, project, subtract, unite, wallLine, type Multi, type Pt, type Seg } from './geom'

/**
 * A battle map's structure: layers, materials, visual themes, and what its shapes add up to
 * (the floor, its walls and the openings in them). Kept apart from drawing (`render.ts`) and
 * light (`lighting.ts`), which both start from here.
 */

export interface LayerDef {
  id: MapLayer
  label: string
  hint: string
}
export const LAYERS: LayerDef[] = [
  { id: 'terrain', label: 'Terrain & background', hint: 'Pictures, ground, water, lava, pits, foliage' },
  { id: 'architecture', label: 'Architecture', hint: 'Floors, walls, doors, stairs' },
  { id: 'props', label: 'Props & dressing', hint: 'Furniture, light sources, traps, details' },
  { id: 'gm', label: 'GM layer', hint: 'Notes, room numbers, triggers: never sent to players' },
  { id: 'tokens', label: 'Tokens', hint: 'Characters and creatures' },
]
export const DEFAULT_ORDER: MapLayer[] = ['terrain', 'architecture', 'props', 'gm', 'tokens']

/** Which layer an element is on: its own choice, else its kind's. */
export function layerOf(el: Element): MapLayer {
  if (el.layer) return el.layer
  switch (el.type) {
    case 'image':
      return 'terrain'
    case 'area':
      return el.material && TERRAIN[el.material] ? 'terrain' : 'architecture'
    case 'wall':
      return 'architecture'
    case 'prop':
    case 'light':
      return 'props'
    case 'token':
      return 'tokens'
    default:
      return 'gm'
  }
}

export type ThemeId = 'blueprint' | 'ink' | 'stone' | 'modern'
export interface MapSettings {
  theme: ThemeId
  layers: { order: MapLayer[]; hidden: MapLayer[]; locked: MapLayer[] }
  /** The layer new drawings go on, where a tool doesn't decide. */
  active?: MapLayer
}
export interface LightingSettings {
  /** How much light there is without lights: full, half, none. */
  ambient: 'day' | 'dusk' | 'dark'
  /** Players see only what their characters can see (walls block sight). */
  vision: boolean
  /** Remember where the party has been: shown dimmed. */
  explored: boolean
}
export const DEFAULT_MAP: MapSettings = { theme: 'stone', layers: { order: DEFAULT_ORDER, hidden: [], locked: [] } }
export const DEFAULT_LIGHTING: LightingSettings = { ambient: 'day', vision: false, explored: true }

export const THEMES: { id: ThemeId; label: string; hint: string }[] = [
  { id: 'stone', label: 'Stone & wood', hint: 'Textured floors, heavy walls, soft shadows' },
  { id: 'ink', label: 'OSR ink', hint: 'Black and white, cross-hatched rock' },
  { id: 'blueprint', label: 'Blueprint', hint: 'White lines on blue' },
  { id: 'modern', label: 'Minimal', hint: 'Flat and clean' },
]

export interface Material {
  label: string
  /** The colour in the textured theme; the flat themes derive theirs. */
  color: string
  /** A second colour for its texture. */
  dark: string
  texture: 'tiles' | 'planks' | 'noise' | 'waves' | 'speckle' | 'flags' | 'none'
}
/** Floors (architecture). */
export const FLOORS: Record<string, Material> = {
  stone: { label: 'Stone tiles', color: '#a39a8c', dark: '#7d7466', texture: 'tiles' },
  flagstone: { label: 'Flagstones', color: '#9c9385', dark: '#6f675b', texture: 'flags' },
  wood: { label: 'Wooden boards', color: '#a47448', dark: '#7a5230', texture: 'planks' },
  cave: { label: 'Cave floor', color: '#8a7d6c', dark: '#6a5e4f', texture: 'noise' },
  dirt: { label: 'Packed earth', color: '#9a7b58', dark: '#76593b', texture: 'speckle' },
  marble: { label: 'Marble', color: '#d8d3c8', dark: '#b4ada0', texture: 'tiles' },
  deck: { label: 'Ship deck', color: '#9c6a3e', dark: '#6f4723', texture: 'planks' },
}
/** Ground (terrain). */
export const TERRAIN: Record<string, Material> = {
  grass: { label: 'Grass', color: '#6f8f4a', dark: '#566f37', texture: 'speckle' },
  foliage: { label: 'Dense foliage', color: '#4c6e35', dark: '#344d24', texture: 'noise' },
  water: { label: 'Water', color: '#4f86a8', dark: '#3a6888', texture: 'waves' },
  deep: { label: 'Deep water', color: '#2f5f84', dark: '#21476a', texture: 'waves' },
  lava: { label: 'Lava', color: '#d9592a', dark: '#9c2f12', texture: 'noise' },
  pit: { label: 'Pit', color: '#1a1714', dark: '#000000', texture: 'none' },
  sand: { label: 'Sand', color: '#d6bf8a', dark: '#b89f69', texture: 'speckle' },
  snow: { label: 'Snow', color: '#e8edf0', dark: '#c9d3da', texture: 'speckle' },
  mud: { label: 'Mud', color: '#6b5540', dark: '#4e3c2b', texture: 'noise' },
  road: { label: 'Dirt road', color: '#a88a62', dark: '#8a6d48', texture: 'speckle' },
  cobbles: { label: 'Cobblestones', color: '#8d877d', dark: '#6a645b', texture: 'flags' },
  swamp: { label: 'Swamp', color: '#55623a', dark: '#3e4a28', texture: 'noise' },
  ice: { label: 'Ice', color: '#bfe0ee', dark: '#94c3d8', texture: 'none' },
  rock: { label: 'Rock', color: '#5e5850', dark: '#47423c', texture: 'noise' },
}
export const materialOf = (name: string | undefined, layer: 'terrain' | 'architecture'): Material =>
  (name && (FLOORS[name] ?? TERRAIN[name])) || (layer === 'terrain' ? TERRAIN.grass : FLOORS.stone)

export const OPENINGS: { kind: NonNullable<WallEl['kind']>; label: string; hint: string }[] = [
  { kind: 'wall', label: 'Wall', hint: 'Blocks movement, sight and light' },
  { kind: 'door', label: 'Door', hint: 'Blocks sight while closed; double-click to open' },
  { kind: 'secret', label: 'Secret door', hint: 'Players see a wall until it opens' },
  { kind: 'window', label: 'Window', hint: 'Sight and light pass, creatures don’t' },
  { kind: 'half', label: 'Half wall', hint: 'Low wall or railing: sight passes' },
  { kind: 'bars', label: 'Bars / portcullis', hint: 'Sight and light pass' },
]

// ---------------------------------------------------------------- what the shapes add up to

export interface Paint {
  id: string
  material: string
  geom: Multi
}
export interface Built {
  /** The floor: every architecture shape added, minus those carved, in order. */
  floor: Multi
  /** Each floor shape's material over the floor, in drawing order (clipped by the floor when drawn). */
  floors: Paint[]
  /** Terrain patches, each minus what was carved from it afterwards. */
  terrain: Paint[]
  /** Walls drawn on their own. */
  walls: { el: WallEl; line: Pt[] }[]
  /** Doors, windows and the rest. */
  openings: { el: WallEl; line: Pt[] }[]
}

const byIndex = (a: Element, b: Element) => (a.index === b.index ? (a.id < b.id ? -1 : 1) : a.index < b.index ? -1 : 1)

/** Build the map's structure from its elements (those on hidden layers are left out by the caller). */
export function build(elements: Element[]): Built {
  const areas = elements.filter((e): e is AreaEl => e.type === 'area' && e.visible !== false).sort(byIndex)
  let floor: Multi = []
  const floors: Paint[] = []
  const terrainAreas: { el: AreaEl; geom: Multi }[] = []
  for (const a of areas) {
    const geom = areaGeometry(a)
    if (layerOf(a) === 'terrain') {
      terrainAreas.push({ el: a, geom })
      continue
    }
    if (a.op === 'carve') floor = subtract(floor, geom)
    else {
      floor = unite(floor, geom)
      floors.push({ id: a.id, material: a.material && FLOORS[a.material] ? a.material : 'stone', geom })
    }
  }
  // A terrain patch loses what later carves take away.
  const terrain: Paint[] = []
  terrainAreas.forEach(({ el, geom }, i) => {
    if (el.op === 'carve') return
    let g = geom
    for (const later of terrainAreas.slice(i + 1)) if (later.el.op === 'carve') g = subtract(g, later.geom)
    if (g.length) terrain.push({ id: el.id, material: el.material && TERRAIN[el.material] ? el.material : 'grass', geom: g })
  })
  const ws = elements.filter((e): e is WallEl => e.type === 'wall' && e.visible !== false && Array.isArray(e.pts) && e.pts.length >= 2).sort(byIndex)
  return {
    floor,
    floors,
    terrain,
    walls: ws.filter((w) => (w.kind ?? 'wall') === 'wall').map((el) => ({ el, line: wallLine(el) })),
    openings: ws.filter((w) => (w.kind ?? 'wall') !== 'wall').map((el) => ({ el, line: wallLine(el) })),
  }
}

/** Whether an opening lets sight (and light) through. */
export const seeThrough = (el: WallEl) => {
  const k = el.kind ?? 'wall'
  if (k === 'window' || k === 'half' || k === 'bars') return true
  if (k === 'door' || k === 'secret') return !!el.open
  return false
}

const segsOf = (line: Pt[]): Seg[] => line.slice(1).map((p, i) => [line[i], p])

/** A wall segment with the parts an opening covers taken out. */
function cut(seg: Seg, holes: Seg[]): Seg[] {
  const [a, b] = seg
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len < 0.5) return []
  const spans: [number, number][] = []
  for (const [c, d] of holes) {
    const pc = project(c, a, b)
    const pd = project(d, a, b)
    // Only openings lying along this wall (within a few pixels of it).
    const off = Math.max(Math.hypot(pc.at[0] - c[0], pc.at[1] - c[1]), Math.hypot(pd.at[0] - d[0], pd.at[1] - d[1]))
    if (off > 8) continue
    const t0 = Math.max(0, Math.min(pc.t, pd.t))
    const t1 = Math.min(1, Math.max(pc.t, pd.t))
    if (t1 > t0) spans.push([t0, t1])
  }
  if (!spans.length) return [seg]
  spans.sort((x, y) => x[0] - y[0])
  const out: Seg[] = []
  let at = 0
  const point = (t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  for (const [s, e] of spans) {
    if (s > at + 1e-6) out.push([point(at), point(s)])
    at = Math.max(at, e)
  }
  if (at < 1 - 1e-6) out.push([point(at), b])
  return out
}

/**
 * What blocks sight and light: the floor's outline and the walls, with the openings that let
 * sight through cut out of them, plus doors that are shut.
 */
export function blockers(b: Built): Seg[] {
  const holes = b.openings.flatMap((o) => segsOf(o.line))
  const out: Seg[] = []
  for (const s of [...edges(b.floor), ...b.walls.flatMap((w) => segsOf(w.line))]) out.push(...cut(s, holes))
  // Shut doors block on their own (the wall behind them was cut out above).
  for (const o of b.openings) if (!seeThrough(o.el)) out.push(...segsOf(o.line))
  return out
}

/** The nearest wall (floor outline or wall element) to a point, for placing doors on it. */
export function nearestWall(b: Built, p: Pt, within: number): { seg: Seg; at: Pt; t: number } | null {
  let best: { seg: Seg; at: Pt; t: number; d: number } | null = null
  for (const seg of [...edges(b.floor), ...b.walls.flatMap((w) => segsOf(w.line))]) {
    const pr = project(p, seg[0], seg[1])
    const t = Math.max(0, Math.min(1, pr.t))
    const at: Pt = [seg[0][0] + (seg[1][0] - seg[0][0]) * t, seg[0][1] + (seg[1][1] - seg[0][1]) * t]
    const d = Math.hypot(at[0] - p[0], at[1] - p[1])
    if (d <= within && (!best || d < best.d)) best = { seg, at, t, d }
  }
  return best
}
