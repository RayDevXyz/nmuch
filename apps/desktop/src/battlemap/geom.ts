import pc from 'polygon-clipping'
import type { AreaEl, WallEl, XYWH } from '../edgeless/model'

/**
 * Battle map geometry: shapes as polygons, merging and carving them, brush strokes, and the
 * line of sight. Polygons follow polygon-clipping's layout: a ring is a closed list of points, a
 * polygon is an outer ring and its holes, a multipolygon is a list of polygons.
 */

export type Pt = [number, number]
export type Ring = Pt[]
export type Poly = Ring[]
export type Multi = Poly[]
export type Seg = [Pt, Pt]

const r2 = (n: number) => Math.round(n * 100) / 100

/** A point of an element (0–1 within its box) in the world, turned with the element. */
export function toWorld(xywh: XYWH, rotate: number | undefined, [u, v]: Pt): Pt {
  const [x, y, w, h] = xywh
  const px = x + u * w
  const py = y + v * h
  if (!rotate) return [px, py]
  const cx = x + w / 2
  const cy = y + h / 2
  const a = (rotate * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c]
}

/** World points as 0–1 within their bounds (the box an element keeps them in). */
export function normalize(points: Pt[], pad = 0): { xywh: XYWH; pts: Pt[] } {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  const w = Math.max(...xs) + pad - x
  const h = Math.max(...ys) + pad - y
  return {
    xywh: [Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))],
    pts: points.map(([px, py]) => [w ? Math.round(((px - x) / w) * 10000) / 10000 : 0, h ? Math.round(((py - y) / h) * 10000) / 10000 : 0]),
  }
}

export function ellipseRing(cx: number, cy: number, rx: number, ry: number, n = 40): Ring {
  const out: Ring = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push([r2(cx + Math.cos(a) * rx), r2(cy + Math.sin(a) * ry)])
  }
  return out
}

/** A circle, or the slice of one between two angles (degrees, clockwise from east). */
export function sector(cx: number, cy: number, r: number, dir?: number, angle?: number, n = 48): Ring {
  if (dir == null || angle == null || angle >= 360) return ellipseRing(cx, cy, r, r, n)
  const a0 = ((dir - angle / 2) * Math.PI) / 180
  const a1 = ((dir + angle / 2) * Math.PI) / 180
  const steps = Math.max(4, Math.ceil((n * angle) / 360))
  const out: Ring = [[cx, cy]]
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    out.push([r2(cx + Math.cos(a) * r), r2(cy + Math.sin(a) * r)])
  }
  return out
}

/** A brush stroke `width` wide along a line, as a polygon (round ends and joints). */
export function strokePolygon(line: Pt[], width: number): Multi {
  const r = Math.max(1, width / 2)
  const parts: Poly[] = []
  const pts = simplify(line, r / 3)
  for (let i = 0; i < pts.length; i++) {
    parts.push([ellipseRing(pts[i][0], pts[i][1], r, r, 16)])
    if (i === 0) continue
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 0.01) continue
    const nx = (-(by - ay) / len) * r
    const ny = ((bx - ax) / len) * r
    parts.push([
      [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ],
    ])
  }
  return unionAll(parts)
}

/** An area's outline in the world. */
export function areaGeometry(el: AreaEl): Multi {
  const [, , w, h] = el.xywh
  const turn = (pts: Pt[]) => pts.map((p) => toWorld(el.xywh, el.rotate, p))
  if (el.shape === 'rect') return [[turn([[0, 0], [1, 0], [1, 1], [0, 1]])]]
  if (el.shape === 'ellipse') {
    const ring = ellipseRing(0.5, 0.5, 0.5, 0.5, Math.min(72, Math.max(24, Math.round((w + h) / 20))))
    return [[turn(ring)]]
  }
  const pts = (el.pts ?? []).map((p) => toWorld(el.xywh, el.rotate, p))
  if (el.shape === 'path') return pts.length ? strokePolygon(pts, el.width ?? 70) : []
  if (pts.length < 3) return [[turn([[0, 0], [1, 0], [1, 1], [0, 1]])]]
  // A polygon drawn crossing itself is made whole by a union with itself.
  return safe(() => pc.union([pts]), [[pts]])
}

/** A wall's line in the world. */
export const wallLine = (el: WallEl): Pt[] => el.pts.map((p) => toWorld(el.xywh, undefined, p))

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f()
  } catch {
    return fallback
  }
}

export function unionAll(parts: Multi[] | Poly[]): Multi {
  const geoms = (parts as (Poly | Multi)[]).filter((g) => g.length)
  if (!geoms.length) return []
  return safe(() => pc.union(geoms[0] as Poly, ...(geoms.slice(1) as Poly[])), geoms.flatMap((g) => (isMulti(g) ? g : [g as Poly])))
}
export const unite = (a: Multi, b: Multi): Multi => (!a.length ? b : !b.length ? a : safe(() => pc.union(a, b), [...a, ...b]))
export const subtract = (a: Multi, b: Multi): Multi => (!a.length || !b.length ? a : safe(() => pc.difference(a, b), a))
export const intersect = (a: Multi, b: Multi): Multi => (!a.length || !b.length ? [] : safe(() => pc.intersection(a, b), []))
const isMulti = (g: Poly | Multi): g is Multi => Array.isArray(g[0]?.[0]?.[0])

/** Douglas–Peucker: drop points closer than `tol` to the line through their neighbours. */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let max = 0
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i], pts[a], pts[b])
      if (d > max) (max = d), (at = i)
    }
    if (at >= 0 && max > tol) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

export function distToSeg([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
/** Where a point falls along a segment (0 at a, 1 at b), and the nearest point on it. */
export function project([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): { t: number; at: Pt } {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = ((px - ax) * dx + (py - ay) * dy) / l2
  return { t, at: [ax + t * dx, ay + t * dy] }
}

/** Every edge of a multipolygon's rings. */
export function edges(m: Multi): Seg[] {
  const out: Seg[] = []
  for (const poly of m)
    for (const ring of poly) {
      const n = ring.length
      // polygon-clipping repeats the first point at the end
      const last = n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? n - 1 : n
      for (let i = 0; i < last; i++) out.push([ring[i], ring[(i + 1) % last]])
    }
  return out
}

/** SVG path data for a multipolygon (use fill-rule evenodd). */
export function pathOf(m: Multi): string {
  let d = ''
  for (const poly of m)
    for (const ring of poly) {
      if (ring.length < 3) continue
      d += `M${ring.map(([x, y]) => `${r2(x)},${r2(y)}`).join('L')}Z`
    }
  return d
}
export const linePath = (pts: Pt[]) => (pts.length ? `M${pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join('L')}` : '')

export function pointIn([x, y]: Pt, m: Multi): boolean {
  let inside = false
  for (const poly of m)
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
  return inside
}

export function boundsOf(m: Multi): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const poly of m)
    for (const [x, y] of poly[0] ?? []) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Rounded and simplified, so a polygon kept in the doc or sent to players stays small. */
export function tidy(m: Multi, tol = 1.5): Multi {
  const out: Multi = []
  for (const poly of m) {
    const rings = poly.map((ring) => simplify(ring.map(([x, y]) => [Math.round(x), Math.round(y)] as Pt), tol)).filter((r) => r.length >= 3)
    if (rings.length && rings[0].length >= 3) out.push(rings)
  }
  return out
}

// ---------------------------------------------------------------- line of sight

/**
 * What can be seen from `o`: the polygon of everything a ray from `o` reaches before a wall, as
 * far as `range`. The classic sweep: a ray towards each wall end (and just either side of it).
 */
export function visibility(o: Pt, walls: Seg[], range: number): Ring {
  const [ox, oy] = o
  const R = range
  // Only the walls that could matter, and a box around the range so every ray ends somewhere.
  const near = walls.filter(([a, b]) => distToSeg(o, a, b) < R)
  const box: Seg[] = [
    [[ox - R, oy - R], [ox + R, oy - R]],
    [[ox + R, oy - R], [ox + R, oy + R]],
    [[ox + R, oy + R], [ox - R, oy + R]],
    [[ox - R, oy + R], [ox - R, oy - R]],
  ]
  const segs = [...near, ...box]
  const angles: number[] = []
  for (const [a, b] of segs)
    for (const [x, y] of [a, b]) {
      const t = Math.atan2(y - oy, x - ox)
      angles.push(t - 0.0001, t, t + 0.0001)
    }
  // Enough rays that a circle's edge looks round when the polygon is cut to the range.
  for (let i = 0; i < 64; i++) angles.push(-Math.PI + (i / 64) * Math.PI * 2)
  angles.sort((a, b) => a - b)
  const out: Ring = []
  let lastA = NaN
  for (const ang of angles) {
    if (ang - lastA < 1e-7) continue
    lastA = ang
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    let best = Infinity
    for (const [[ax, ay], [bx, by]] of segs) {
      const ex = bx - ax
      const ey = by - ay
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-12) continue
      const t = ((ax - ox) * ey - (ay - oy) * ex) / den
      const u = ((ax - ox) * dy - (ay - oy) * dx) / den
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t
    }
    if (best === Infinity) continue
    best = Math.min(best, R * 1.5)
    out.push([r2(ox + dx * best), r2(oy + dy * best)])
  }
  return out
}

/** What a source at `o` sees within `range` (and within a cone, if given): a multipolygon. */
export function sightArea(o: Pt, walls: Seg[], range: number, cone?: { dir: number; angle: number }): Multi {
  const vis = visibility(o, walls, range)
  if (vis.length < 3) return []
  const reach = sector(o[0], o[1], range, cone?.dir, cone?.angle)
  return intersect([[vis]], [[reach]])
}
