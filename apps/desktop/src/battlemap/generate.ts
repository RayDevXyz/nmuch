import type { NewElement } from '../edgeless/model'
import { normalize, type Pt } from './geom'
import { builtinById } from './props'

/**
 * Procedural maps. Each generator makes ordinary battle map elements (rooms, terrain, walls,
 * doors, props, GM notes), so a generated map is edited like a drawn one. The same seed makes
 * the same map.
 */

export type Biome = 'dungeon' | 'wilderness' | 'village' | 'town' | 'tavern' | 'camp' | 'ship'
export type Size = 'small' | 'medium' | 'large'
export const BIOMES: { id: Biome; label: string; hint: string }[] = [
  { id: 'dungeon', label: 'Dungeon', hint: 'Rooms joined by corridors, doors (some secret), traps, torches and numbered rooms on the GM layer.' },
  { id: 'wilderness', label: 'Wilderness', hint: 'A river, a road, woods, rocks and clearings.' },
  { id: 'village', label: 'Village', hint: 'Cottages along dirt roads around a well.' },
  { id: 'town', label: 'Town', hint: 'Cobbled streets, blocks of houses and shops, a market square.' },
  { id: 'tavern', label: 'Tavern', hint: 'A common room with a bar and a hearth, a kitchen and a store room.' },
  { id: 'camp', label: 'Camp', hint: 'Tents around a campfire in a clearing.' },
  { id: 'ship', label: 'Ship', hint: 'A sailing ship on open water: masts, cannons, a captain’s cabin.' },
]

export interface GenOpts {
  size: Size
  seed: number
  grid: number
  /** Where the map's middle goes. */
  cx: number
  cy: number
}

/** A small, fast seeded random generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0 || 1
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}
type R = ReturnType<typeof rng>

/** Builds elements in grid squares from a top-left origin. */
class Out {
  els: NewElement[] = []
  constructor(
    readonly g: number,
    readonly ox: number,
    readonly oy: number,
    readonly tag: string,
  ) {}
  px = (c: number) => c * this.g
  /** A rectangle of squares: a room (architecture) or a patch (terrain). */
  rect(c: number, r: number, w: number, h: number, material: string, layer: 'architecture' | 'terrain', op: 'add' | 'carve' = 'add') {
    this.els.push({ type: 'area', shape: 'rect', xywh: [this.ox + c * this.g, this.oy + r * this.g, w * this.g, h * this.g], op: op === 'carve' ? 'carve' : 'add', ...(op === 'carve' ? {} : { material }), layer })
  }
  ellipse(c: number, r: number, w: number, h: number, material: string, layer: 'architecture' | 'terrain') {
    this.els.push({ type: 'area', shape: 'ellipse', xywh: [this.ox + c * this.g, this.oy + r * this.g, w * this.g, h * this.g], op: 'add', material, layer })
  }
  /** A polygon, its corners in squares. */
  poly(pts: Pt[], material: string, layer: 'architecture' | 'terrain') {
    const n = normalize(pts.map(([c, r]) => [this.ox + c * this.g, this.oy + r * this.g]))
    this.els.push({ type: 'area', shape: 'poly', xywh: n.xywh, pts: n.pts, op: 'add', material, layer })
  }
  /** A brush stroke (a river, a road), its line in squares and its width in squares. */
  path(pts: Pt[], width: number, material: string) {
    const n = normalize(pts.map(([c, r]) => [this.ox + c * this.g, this.oy + r * this.g]))
    this.els.push({ type: 'area', shape: 'path', xywh: n.xywh, pts: n.pts, width: width * this.g, op: 'add', material, layer: 'terrain' })
  }
  /** A wall or an opening along a line of square corners. */
  wall(pts: Pt[], kind: 'wall' | 'door' | 'secret' | 'window' | 'half' | 'bars' = 'wall', open = false) {
    const n = normalize(pts.map(([c, r]) => [this.ox + c * this.g, this.oy + r * this.g]))
    this.els.push({ type: 'wall', xywh: n.xywh, pts: n.pts, kind, ...(open ? { open: true } : {}) })
  }
  /** A prop centred on a point (in squares), turned `rot` degrees. */
  prop(id: string, c: number, r: number, rot = 0, layer: 'props' | 'gm' = 'props') {
    const def = builtinById.get(id)
    if (!def) return
    const w = def.w * this.g
    const h = def.h * this.g
    this.els.push({ type: 'prop', asset: `b:${id}`, xywh: [Math.round(this.ox + c * this.g - w / 2), Math.round(this.oy + r * this.g - h / 2), Math.round(w), Math.round(h)], ...(rot ? { rotate: rot } : {}), layer })
  }
  /** A note only the GM sees (a room number). */
  label(text: string, c: number, r: number) {
    const s = this.g * 0.8
    this.els.push({ type: 'text', xywh: [Math.round(this.ox + c * this.g - s / 2), Math.round(this.oy + r * this.g - s / 2), Math.round(s), Math.round(s)], text, fontSize: Math.round(this.g * 0.45), bold: true, align: 'center', color: 'red', layer: 'gm', group: this.tag })
  }
}

const DIM: Record<Size, [number, number]> = { small: [28, 20], medium: [42, 30], large: [58, 42] }

export function generate(biome: Biome, o: GenOpts): NewElement[] {
  const r = rng(o.seed * 7919 + biome.length * 104729)
  const [W, H] = biome === 'tavern' ? ({ small: [20, 14], medium: [24, 18], large: [30, 22] } as const)[o.size] : biome === 'ship' ? ({ small: [30, 16], medium: [38, 20], large: [46, 24] } as const)[o.size] : DIM[o.size]
  const ox = Math.round((o.cx - (W * o.grid) / 2) / o.grid) * o.grid
  const oy = Math.round((o.cy - (H * o.grid) / 2) / o.grid) * o.grid
  const out = new Out(o.grid, ox, oy, `gen${o.seed}`)
  const make = { dungeon, wilderness, village, town, tavern, camp, ship }[biome]
  make(out, r, W, H, o.size)
  return out.els
}

// ---------------------------------------------------------------- dungeon

interface Room {
  c: number
  r: number
  w: number
  h: number
}
const inRoom = (rm: Room, c: number, r: number) => c >= rm.c && c < rm.c + rm.w && r >= rm.r && r < rm.r + rm.h
const centre = (rm: Room): Pt => [rm.c + Math.floor(rm.w / 2), rm.r + Math.floor(rm.h / 2)]

function dungeon(o: Out, r: R, W: number, H: number, size: Size) {
  const want = { small: 6, medium: 10, large: 15 }[size]
  const rooms: Room[] = []
  for (let tries = 0; tries < 400 && rooms.length < want; tries++) {
    const w = r.int(3, 8)
    const h = r.int(3, 7)
    const rm = { c: r.int(1, W - w - 1), r: r.int(1, H - h - 1), w, h }
    if (rooms.some((x) => rm.c < x.c + x.w + 2 && x.c < rm.c + rm.w + 2 && rm.r < x.r + x.h + 2 && x.r < rm.r + rm.h + 2)) continue
    rooms.push(rm)
  }
  rooms.sort((a, b) => a.c + a.r - (b.c + b.r))
  const floor = r.pick(['flagstone', 'stone', 'stone'])
  rooms.forEach((rm, i) => o.rect(rm.c, rm.r, rm.w, rm.h, i === rooms.length - 1 && r.chance(0.5) ? 'marble' : floor, 'architecture'))

  // Corridors: a minimum spanning tree over the rooms, plus a few loops.
  const links: [number, number][] = []
  const inTree = new Set([0])
  while (inTree.size < rooms.length) {
    let best: [number, number, number] | null = null
    for (const a of inTree)
      for (let b = 0; b < rooms.length; b++) {
        if (inTree.has(b)) continue
        const [ac, ar] = centre(rooms[a])
        const [bc, br] = centre(rooms[b])
        const d = Math.abs(ac - bc) + Math.abs(ar - br)
        if (!best || d < best[2]) best = [a, b, d]
      }
    if (!best) break
    links.push([best[0], best[1]])
    inTree.add(best[1])
  }
  for (let i = 0; i < Math.round(rooms.length / 5); i++) {
    const a = r.int(0, rooms.length - 1)
    const b = r.int(0, rooms.length - 1)
    if (a !== b && !links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) links.push([a, b])
  }
  const roomAt = (c: number, rr: number) => rooms.findIndex((rm) => inRoom(rm, c, rr))
  const doors = new Set<string>()
  const corridorCells = new Set<string>()
  for (const [a, b] of links) {
    const [ac, ar] = centre(rooms[a])
    const [bc, br] = centre(rooms[b])
    const cells: Pt[] = []
    const horizontalFirst = r.chance(0.5)
    let c = ac
    let rr = ar
    cells.push([c, rr])
    const stepTo = (tc: number, tr: number) => {
      while (c !== tc) cells.push([(c += Math.sign(tc - c)), rr])
      while (rr !== tr) cells.push([c, (rr += Math.sign(tr - rr))])
    }
    if (horizontalFirst) stepTo(bc, ar), stepTo(bc, br)
    else stepTo(ac, br), stepTo(bc, br)
    // The corridor: its straight runs outside rooms, one square wide.
    for (const [cc, cr] of cells) if (roomAt(cc, cr) < 0) corridorCells.add(`${cc},${cr}`)
    // Doors where it goes into a room.
    for (let i = 1; i < cells.length; i++) {
      const [pc, pr] = cells[i - 1]
      const [qc, qr] = cells[i]
      const inP = roomAt(pc, pr) >= 0
      const inQ = roomAt(qc, qr) >= 0
      if (inP === inQ) continue
      const key = `${Math.max(pc, qc)},${Math.max(pr, qr)},${pc === qc ? 'h' : 'v'}`
      if (doors.has(key)) continue
      doors.add(key)
      const roll = r.next()
      if (roll < 0.25) continue // an open archway
      const kind = roll < 0.35 ? 'secret' : 'door'
      if (pc === qc) {
        const y = Math.max(pr, qr)
        o.wall([[pc, y], [pc + 1, y]], kind)
      } else {
        const x = Math.max(pc, qc)
        o.wall([[x, pr], [x, pr + 1]], kind)
      }
    }
  }
  // Corridor squares, merged into rows.
  const byRow = new Map<number, number[]>()
  for (const k of corridorCells) {
    const [c, rr] = k.split(',').map(Number)
    byRow.set(rr, [...(byRow.get(rr) ?? []), c])
  }
  for (const [rr, cs] of byRow) {
    cs.sort((a, b) => a - b)
    let start = cs[0]
    for (let i = 1; i <= cs.length; i++) {
      if (i < cs.length && cs[i] === cs[i - 1] + 1) continue
      o.rect(start, rr, cs[i - 1] - start + 1, 1, floor, 'architecture')
      start = cs[i]
    }
  }
  // A trap or two in the corridors.
  const corr = [...corridorCells].map((k) => k.split(',').map(Number) as Pt)
  for (let i = 0; i < Math.min(corr.length, { small: 1, medium: 2, large: 3 }[size]); i++) {
    const [c, rr] = r.pick(corr)
    o.prop(r.pick(['spikes', 'pit-trap', 'plate']), c + 0.5, rr + 0.5, 0, r.chance(0.6) ? 'gm' : 'props')
  }

  // Dressing each room, and its number for the GM.
  rooms.forEach((rm, i) => {
    o.label(String(i + 1), rm.c + 0.7, rm.r + 0.7)
    const free = () => [rm.c + 0.5 + r.int(0, rm.w - 1), rm.r + 0.5 + r.int(0, rm.h - 1)] as Pt
    // Torches on the walls.
    o.prop('torch', rm.c + rm.w / 2, rm.r + 0.25)
    if (rm.w * rm.h > 24) o.prop('torch', rm.c + rm.w / 2, rm.r + rm.h - 0.25)
    if (i === 0) o.prop('stairs', rm.c + 0.5, rm.r + rm.h - 1)
    if (rm.w >= 6 && rm.h >= 5) for (const [dc, dr] of [[1.5, 1.5], [rm.w - 1.5, 1.5], [1.5, rm.h - 1.5], [rm.w - 1.5, rm.h - 1.5]]) o.prop('pillar', rm.c + dc, rm.r + dr)
    const n = r.int(1, 3)
    for (let k = 0; k < n; k++) {
      const [c, rr] = free()
      o.prop(r.pick(['barrel', 'crate', 'rubble', 'bones', 'sacks', 'rubble', 'mushrooms']), c, rr, r.int(0, 3) * 90)
    }
    if (r.chance(0.3)) {
      const [c, rr] = free()
      o.prop('chest', c, rr)
    }
    if (i === rooms.length - 1) {
      o.prop(r.pick(['altar', 'statue', 'sarcophagus', 'throne']), rm.c + rm.w / 2, rm.r + Math.min(1.5, rm.h / 2))
      o.prop('brazier', rm.c + 1, rm.r + rm.h - 1)
    }
  })
}

// ---------------------------------------------------------------- outdoors

/** A wandering line across the map (a river, a road). */
function wander(r: R, from: Pt, to: Pt, steps: number, sway: number): Pt[] {
  const pts: Pt[] = []
  let drift = 0
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    drift += (r.next() - 0.5) * sway
    drift *= 0.85
    const nx = -(to[1] - from[1])
    const ny = to[0] - from[0]
    const l = Math.hypot(nx, ny) || 1
    const edge = i === 0 || i === steps ? 0 : 1
    pts.push([from[0] + (to[0] - from[0]) * t + (nx / l) * drift * edge, from[1] + (to[1] - from[1]) * t + (ny / l) * drift * edge])
  }
  return pts
}
const nearLine = (p: Pt, line: Pt[], d: number) =>
  line.some((q, i) => {
    if (!i) return false
    const a = line[i - 1]
    const dx = q[0] - a[0]
    const dy = q[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) < d
  })

/** Scatter things at least `gap` apart, away from what `avoid` says. */
function scatter(r: R, W: number, H: number, n: number, gap: number, avoid: (p: Pt) => boolean): Pt[] {
  const out: Pt[] = []
  for (let tries = 0; tries < n * 30 && out.length < n; tries++) {
    const p: Pt = [r.next() * W, r.next() * H]
    if (avoid(p) || out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < gap)) continue
    out.push(p)
  }
  return out
}

function wilderness(o: Out, r: R, W: number, H: number) {
  o.rect(0, 0, W, H, 'grass', 'terrain')
  for (let i = 0; i < 4; i++) o.ellipse(r.int(0, W - 8), r.int(0, H - 6), r.int(5, 10), r.int(4, 8), r.pick(['foliage', 'foliage', 'mud']), 'terrain')
  const river = wander(r, [r.int(W * 0.2, W * 0.5), -1], [r.int(W * 0.5, W * 0.8), H + 1], 14, 3)
  const rw = r.pick([2, 2.5, 3])
  o.path(river, rw, 'water')
  const road = wander(r, [-1, r.int(H * 0.3, H * 0.7)], [W + 1, r.int(H * 0.3, H * 0.7)], 12, 2)
  o.path(road, 1.6, 'road')
  if (r.chance(0.6)) o.ellipse(r.int(2, W - 8), r.int(2, H - 6), r.int(4, 6), r.int(3, 5), 'water', 'terrain')
  const clear = (p: Pt) => nearLine(p, river, rw / 2 + 1) || nearLine(p, road, 1.6)
  for (const [c, rr] of scatter(r, W, H, Math.round((W * H) / 22), 2.2, clear)) o.prop(r.pick(['tree', 'tree', 'pine', 'pine', 'bush']), c, rr, r.int(0, 3) * 90)
  for (const [c, rr] of scatter(r, W, H, Math.round((W * H) / 70), 2, clear)) o.prop(r.pick(['rock', 'boulder', 'log', 'stump', 'flowers', 'mushrooms']), c, rr, r.int(0, 7) * 45)
  for (const [c, rr] of scatter(r, W, H, 4, 2, (p) => !nearLine(p, river, rw / 2 + 1.2) || nearLine(p, river, rw / 2))) o.prop('reeds', c, rr)
}

/** A small house: a wooden room with a door on one side and a few things inside. */
function house(o: Out, r: R, c: number, rr: number, w: number, h: number, doorSide: 'n' | 's' | 'e' | 'w', floor = 'wood') {
  o.rect(c, rr, w, h, floor, 'architecture')
  const dc = c + Math.floor(w / 2)
  const dr = rr + Math.floor(h / 2)
  if (doorSide === 'n') o.wall([[dc, rr], [dc + 1, rr]], 'door')
  if (doorSide === 's') o.wall([[dc, rr + h], [dc + 1, rr + h]], 'door')
  if (doorSide === 'w') o.wall([[c, dr], [c, dr + 1]], 'door')
  if (doorSide === 'e') o.wall([[c + w, dr], [c + w, dr + 1]], 'door')
  if (w >= 3 && h >= 3) {
    if (r.chance(0.5)) o.wall([[c + w, rr + 1], [c + w, rr + 2]], 'window')
    o.prop('bed', c + 0.5, rr + 1, 0)
    o.prop(r.pick(['table-round', 'table']), c + w / 2 + 0.3, rr + h / 2 + 0.2)
    o.prop(r.pick(['barrel', 'chest', 'wardrobe']), c + w - 0.6, rr + 0.5)
    if (r.chance(0.5)) o.prop('fireplace', c + w / 2 + 0.5, rr + h - 0.3, 0)
  }
}

function village(o: Out, r: R, W: number, H: number, size: Size) {
  o.rect(0, 0, W, H, 'grass', 'terrain')
  const midR = Math.round(H / 2)
  const midC = Math.round(W / 2)
  const main = wander(r, [-1, midR], [W + 1, midR + r.int(-2, 2)], 10, 1.2)
  const branch = wander(r, [midC, midR], [midC + r.int(-4, 4), H + 1], 6, 1)
  const north = wander(r, [midC, midR], [midC + r.int(-6, 6), -1], 6, 1)
  for (const p of [main, branch, north]) o.path(p, 2, 'road')
  o.prop('well', midC + 2.5, midR - 2.5)
  const houses: Room[] = []
  const want = { small: 5, medium: 8, large: 12 }[size]
  for (let tries = 0; tries < 300 && houses.length < want; tries++) {
    const w = r.int(3, 5)
    const h = r.int(3, 4)
    const c = r.int(1, W - w - 1)
    const rr = r.int(1, H - h - 1)
    const rm = { c, r: rr, w, h }
    const corners: Pt[] = [[c, rr], [c + w, rr], [c, rr + h], [c + w, rr + h], [c + w / 2, rr + h / 2]]
    if (corners.some((p) => nearLine(p, main, 2) || nearLine(p, branch, 2) || nearLine(p, north, 2))) continue
    if (Math.hypot(c + w / 2 - midC - 2.5, rr + h / 2 - midR + 2.5) < 4) continue
    if (houses.some((x) => c < x.c + x.w + 2 && x.c < c + w + 2 && rr < x.r + x.h + 2 && x.r < rr + h + 2)) continue
    // Only near a road.
    if (!corners.some((p) => nearLine(p, main, 6) || nearLine(p, branch, 6) || nearLine(p, north, 6))) continue
    houses.push(rm)
    const side = rr + h / 2 < midR ? 's' : 'n'
    house(o, r, c, rr, w, h, side)
  }
  const busy = (p: Pt) => nearLine(p, main, 2) || nearLine(p, branch, 2) || nearLine(p, north, 2) || houses.some((h) => p[0] > h.c - 1 && p[0] < h.c + h.w + 1 && p[1] > h.r - 1 && p[1] < h.r + h.h + 1)
  for (const [c, rr] of scatter(r, W, H, Math.round((W * H) / 45), 2.5, busy)) o.prop(r.pick(['tree', 'pine', 'bush', 'bush', 'flowers']), c, rr, r.int(0, 3) * 90)
  for (const [c, rr] of scatter(r, W, H, 5, 3, busy)) o.prop(r.pick(['crate', 'barrel', 'cart', 'log', 'sacks']), c, rr, r.int(0, 3) * 90)
}

function town(o: Out, r: R, W: number, H: number) {
  o.rect(0, 0, W, H, 'cobbles', 'terrain')
  const street = 2
  const block = 7
  const sq = { c: Math.floor(W / 2 / (block + street)) * (block + street), r: Math.floor(H / 2 / (block + street)) * (block + street) }
  for (let bc = street; bc + block <= W; bc += block + street)
    for (let br = street; br + block <= H; br += block + street) {
      if (bc === sq.c + street && br === sq.r + street) {
        // The market square.
        o.prop('fountain', bc + block / 2, br + block / 2)
        for (const [dc, dr] of [[1.2, 1.5], [block - 1.2, 1.5], [1.2, block - 1.5], [block - 1.2, block - 1.5]]) {
          o.prop('table', bc + dc, br + dr, 90)
          o.prop(r.pick(['crate', 'barrel', 'sacks']), bc + dc + (dc < block / 2 ? 0.9 : -0.9), br + dr)
        }
        continue
      }
      // A block: two to four buildings that fill it.
      const split = r.int(3, 4)
      const parts: Room[] = r.chance(0.5)
        ? [
            { c: bc, r: br, w: split, h: block },
            { c: bc + split, r: br, w: block - split, h: block },
          ]
        : [
            { c: bc, r: br, w: block, h: split },
            { c: bc, r: br + split, w: block, h: block - split },
          ]
      for (const p of parts) {
        const sides: ('n' | 's' | 'e' | 'w')[] = []
        if (p.r === br) sides.push('n')
        if (p.r + p.h === br + block) sides.push('s')
        if (p.c === bc) sides.push('w')
        if (p.c + p.w === bc + block) sides.push('e')
        house(o, r, p.c, p.r, p.w, p.h, r.pick(sides), r.pick(['wood', 'stone', 'flagstone']))
      }
    }
  for (let i = 0; i < 6; i++) o.prop(r.pick(['barrel', 'crate', 'cart', 'sacks']), r.int(0, W - 1) + 0.5, r.pick([0.8, H - 0.8]))
}

function tavern(o: Out, r: R, W: number, H: number) {
  o.rect(0, 0, W, H, 'grass', 'terrain')
  o.path([[-1, H - 2], [W + 1, H - 2]], 2.2, 'road')
  const bw = W - 6
  const bh = H - 6
  const c0 = 3
  const r0 = 1
  o.rect(c0, r0, bw, bh, 'wood', 'architecture')
  // The kitchen and the store room at the back, behind an inner wall.
  const kw = Math.max(4, Math.round(bw / 4))
  const kx = c0 + bw - kw
  o.wall([[kx, r0], [kx, r0 + bh]])
  const split = r0 + Math.floor(bh / 2)
  o.wall([[kx, split], [kx + kw, split]])
  o.wall([[kx, r0 + 2], [kx, r0 + 3]], 'door')
  o.wall([[kx, split + 1], [kx, split + 2]], 'door')
  o.rect(kx, r0, kw, split - r0, 'flagstone', 'architecture')
  o.prop('cauldron', kx + kw / 2, r0 + 1.2)
  o.prop('fireplace', kx + kw / 2, r0 + 0.3)
  o.prop('table', kx + kw / 2, r0 + (split - r0) / 2 + 0.5)
  for (let i = 0; i < 4; i++) o.prop(r.pick(['barrel', 'crate', 'sacks']), kx + 0.6 + (i % 2) * (kw - 1.2), split + 0.7 + Math.floor(i / 2) * 1.2)
  o.prop('stairs', kx + kw - 0.5, r0 + bh - 1, 0)
  // The front door, windows.
  o.wall([[c0 + Math.floor((bw - kw) / 2), r0 + bh], [c0 + Math.floor((bw - kw) / 2) + 1, r0 + bh]], 'door')
  for (let c = c0 + 2; c < kx - 1; c += 4) o.wall([[c, r0], [c + 1, r0]], 'window')
  // The bar, along the inner wall.
  o.prop('counter', kx - 1, r0 + bh / 2, 90)
  for (let i = 0; i < Math.floor(bh / 2); i++) o.prop('stool', kx - 2.1, r0 + 1.5 + i * 1.6)
  o.prop('barrel', kx - 0.4, r0 + 0.6)
  o.prop('barrel', kx - 0.4, r0 + bh - 0.6)
  // The hearth and the tables.
  o.prop('fireplace', c0 + 0.3, r0 + bh / 2, 90)
  o.prop('rug', c0 + 2.2, r0 + bh / 2, 90)
  const tables: Pt[] = []
  for (let c = c0 + 3; c < kx - 4; c += 3) for (let rr = r0 + 2; rr < r0 + bh - 1; rr += 3) tables.push([c, rr])
  for (const [c, rr] of tables) {
    const round = r.chance(0.6)
    o.prop(round ? 'table-round' : 'table', c, rr, round ? 0 : 90)
    for (const [dc, dr] of [[0, -0.8], [0, 0.8], [-0.8, 0], [0.8, 0]]) if (r.chance(0.75)) o.prop('chair', c + dc, rr + dr, dr < 0 ? 0 : dr > 0 ? 180 : dc < 0 ? 270 : 90)
    if (r.chance(0.4)) o.prop('candles', c, rr)
  }
  o.prop('lantern', c0 + Math.floor((bw - kw) / 2) + 0.5, r0 + bh + 0.5)
  for (const [c, rr] of scatter(r, W, H, 8, 2.5, (p) => (p[0] > c0 - 1.5 && p[0] < c0 + bw + 1.5 && p[1] > r0 - 1.5 && p[1] < r0 + bh + 1.5) || p[1] > H - 3.5)) o.prop(r.pick(['tree', 'bush', 'bush', 'cart']), c, rr)
}

function camp(o: Out, r: R, W: number, H: number, size: Size) {
  o.rect(0, 0, W, H, 'grass', 'terrain')
  const cx = W / 2
  const cy = H / 2
  const rad = { small: 5, medium: 7, large: 9 }[size]
  o.ellipse(cx - rad - 1, cy - rad - 1, (rad + 1) * 2, (rad + 1) * 2, 'road', 'terrain')
  o.prop('campfire', cx, cy)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4
    o.prop('log', cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, (a * 180) / Math.PI + 90)
  }
  const tents = { small: 3, medium: 5, large: 7 }[size]
  for (let i = 0; i < tents; i++) {
    const a = (i / tents) * Math.PI * 2 + r.next() * 0.3
    const tx = cx + Math.cos(a) * (rad - 1)
    const ty = cy + Math.sin(a) * (rad - 1)
    o.prop('tent', tx, ty, Math.round((a * 180) / Math.PI / 45) * 45)
    o.prop('bedroll', cx + Math.cos(a) * (rad - 3), cy + Math.sin(a) * (rad - 3), (a * 180) / Math.PI + 90)
  }
  o.prop('cart', cx + rad + 2, cy, 90)
  for (let i = 0; i < 4; i++) o.prop(r.pick(['crate', 'sacks', 'barrel']), cx + rad + 0.5 + (i % 2), cy - 2 + i)
  o.prop('lantern', cx + rad + 1, cy - 2.5)
  for (const [c, rr] of scatter(r, W, H, Math.round((W * H) / 30), 2.4, (p) => Math.hypot(p[0] - cx, p[1] - cy) < rad + 3)) o.prop(r.pick(['tree', 'pine', 'pine', 'bush', 'rock']), c, rr, r.int(0, 3) * 90)
}

function ship(o: Out, r: R, W: number, H: number) {
  o.rect(0, 0, W, H, 'deep', 'terrain')
  const len = W - 8
  const beam = Math.min(H - 6, Math.round(len / 3.2))
  const x0 = 3
  const y0 = Math.round((H - beam) / 2)
  const bow = Math.round(beam * 1.2)
  const mid = y0 + beam / 2
  // The hull: square at the stern (left), pointed at the bow (right).
  o.poly(
    [
      [x0, y0 + 1],
      [x0 + 1, y0],
      [x0 + len - bow, y0],
      [x0 + len - bow / 3, y0 + beam * 0.2],
      [x0 + len, mid],
      [x0 + len - bow / 3, y0 + beam * 0.8],
      [x0 + len - bow, y0 + beam],
      [x0 + 1, y0 + beam],
      [x0, y0 + beam - 1],
    ],
    'deck',
    'architecture',
  )
  // The captain's cabin at the stern.
  const cab = Math.max(4, Math.round(len / 5))
  o.wall([[x0 + cab, y0], [x0 + cab, y0 + beam]])
  o.wall([[x0 + cab, Math.floor(mid)], [x0 + cab, Math.floor(mid) + 1]], 'door')
  o.wall([[x0, Math.floor(mid) - 1], [x0, Math.floor(mid)]], 'window')
  o.prop('desk', x0 + cab / 2, mid - 1)
  o.prop('chest', x0 + 1, y0 + 0.8)
  o.prop('bed', x0 + cab - 0.6, y0 + beam - 1.1, 90)
  o.prop('lantern', x0 + cab / 2, mid + 0.5)
  // Deck: helm, masts, hatch, cannons along both sides, cargo.
  o.prop('helm', x0 + cab + 1, mid)
  const masts = len > 28 ? 3 : 2
  for (let i = 0; i < masts; i++) o.prop('mast', x0 + cab + 3 + ((len - bow - cab - 3) * (i + 0.5)) / masts, mid)
  o.prop('hatch', x0 + cab + (len - bow - cab) / 2 + 1, mid + (beam > 6 ? 1.5 : 0))
  for (let c = x0 + cab + 2; c < x0 + len - bow - 1; c += 3) {
    // Muzzles out over the rails.
    o.prop('cannon', c, y0 + 1, 0)
    o.prop('cannon', c, y0 + beam - 1, 180)
  }
  for (let i = 0; i < 5; i++) o.prop(r.pick(['crate', 'barrel', 'rope', 'sacks']), x0 + len - bow + 1 + r.next() * (bow / 2), mid - beam / 4 + r.next() * (beam / 2))
  o.prop('anchor', x0 + len - 2.2, mid)
}
