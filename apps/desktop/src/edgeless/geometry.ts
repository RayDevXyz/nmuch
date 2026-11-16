import type { Rect, XYWH } from './model'

/**
 * Geometry for the canvas's editing: turned items, resizing in an item's own frame, and the
 * smart guides that line items up while they move.
 */

const rad = (deg: number) => (deg * Math.PI) / 180

/** The axis-aligned box around a rectangle turned `deg` degrees about its center. */
export function turnedBounds([x, y, w, h]: XYWH, deg = 0): Rect {
  if (!deg) return { x, y, w, h }
  const c = Math.abs(Math.cos(rad(deg)))
  const s = Math.abs(Math.sin(rad(deg)))
  const bw = w * c + h * s
  const bh = w * s + h * c
  return { x: x + w / 2 - bw / 2, y: y + h / 2 - bh / 2, w: bw, h: bh }
}

/**
 * Resize a (possibly turned) box by dragging one of its handles (`n`, `se`, …) by (dx, dy) in
 * world space. The opposite side stays where it is. `keepRatio`: corners keep the proportions.
 */
export function resizeTurned(orig: XYWH, deg: number, handle: string, dx: number, dy: number, min: number, keepRatio: boolean): XYWH {
  const [x, y, w, h] = orig
  const r = rad(deg)
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  // The drag in the box's own (unturned) axes.
  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos
  let l = -w / 2
  let t = -h / 2
  let rr = w / 2
  let b = h / 2
  if (handle.includes('e')) rr = Math.max(l + min, rr + lx)
  if (handle.includes('w')) l = Math.min(rr - min, l + lx)
  if (handle.includes('s')) b = Math.max(t + min, b + ly)
  if (handle.includes('n')) t = Math.min(b - min, t + ly)
  if (keepRatio && handle.length === 2) {
    const ratio = w / h
    const nw = rr - l
    const nh = b - t
    // Follow the side that moved more, relative to its size.
    if (nw / w > nh / h) {
      const fixedH = nw / ratio
      if (handle.includes('n')) t = b - fixedH
      else b = t + fixedH
    } else {
      const fixedW = nh * ratio
      if (handle.includes('w')) l = rr - fixedW
      else rr = l + fixedW
    }
  }
  const nw = rr - l
  const nh = b - t
  // The new center, back in world space.
  const cx = (l + rr) / 2
  const cy = (t + b) / 2
  const wx = x + w / 2 + cx * cos - cy * sin
  const wy = y + h / 2 + cx * sin + cy * cos
  return [Math.round(wx - nw / 2), Math.round(wy - nh / 2), Math.round(nw), Math.round(nh)]
}

/** The angle (degrees, 0 = handle straight up) from a box's center to a point; Shift snaps to 15°. */
export function angleTo(cx: number, cy: number, px: number, py: number, fine: boolean): number {
  let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90
  a = ((a % 360) + 360) % 360
  if (!fine) a = Math.round(a / 15) * 15
  else {
    // Settle on the square angles when close.
    for (const k of [0, 90, 180, 270, 360]) if (Math.abs(a - k) < 3) a = k
    a = Math.round(a)
  }
  return a % 360
}

/** A guide line to draw: vertical at x (from y1 to y2), or horizontal at y. */
export type Guide = { axis: 'x'; at: number; from: number; to: number } | { axis: 'y'; at: number; from: number; to: number }

/**
 * Snap a moving box to the others: its left/center/right lines to theirs, and its
 * top/middle/bottom too. Returns how far to shift it and the guides to show.
 */
export function snapBox(moving: Rect, others: Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w]
  const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h]
  let best = { dx: Infinity, dy: Infinity }
  for (const o of others) {
    for (const a of xs(moving)) for (const b of xs(o)) if (Math.abs(b - a) < Math.abs(best.dx) && Math.abs(b - a) <= threshold) best.dx = b - a
    for (const a of ys(moving)) for (const b of ys(o)) if (Math.abs(b - a) < Math.abs(best.dy) && Math.abs(b - a) <= threshold) best.dy = b - a
  }
  const dx = Number.isFinite(best.dx) ? best.dx : 0
  const dy = Number.isFinite(best.dy) ? best.dy : 0
  const m = { ...moving, x: moving.x + dx, y: moving.y + dy }
  const guides: Guide[] = []
  for (const o of others) {
    for (const a of xs(m))
      if (Number.isFinite(best.dx) && xs(o).some((b) => Math.abs(b - a) < 0.5)) guides.push({ axis: 'x', at: a, from: Math.min(m.y, o.y), to: Math.max(m.y + m.h, o.y + o.h) })
    for (const a of ys(m))
      if (Number.isFinite(best.dy) && ys(o).some((b) => Math.abs(b - a) < 0.5)) guides.push({ axis: 'y', at: a, from: Math.min(m.x, o.x), to: Math.max(m.x + m.w, o.x + o.w) })
  }
  return { dx, dy, guides: dedupe(guides) }
}

/** Snap the sides a resize moves (unturned boxes only). */
export function snapEdges(box: XYWH, handle: string, others: Rect[], threshold: number): { box: XYWH; guides: Guide[] } {
  let [x, y, w, h] = box
  const guides: Guide[] = []
  const near = (v: number, lines: number[]) => {
    let best: number | null = null
    for (const l of lines) if (Math.abs(l - v) <= threshold && (best === null || Math.abs(l - v) < Math.abs(best - v))) best = l
    return best
  }
  const vx = others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])
  const vy = others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])
  if (handle.includes('e')) {
    const s = near(x + w, vx)
    if (s !== null) (w = s - x), guides.push({ axis: 'x', at: s, from: y, to: y + h })
  }
  if (handle.includes('w')) {
    const s = near(x, vx)
    if (s !== null) (w = w + x - s), (x = s), guides.push({ axis: 'x', at: s, from: y, to: y + h })
  }
  if (handle.includes('s')) {
    const s = near(y + h, vy)
    if (s !== null) (h = s - y), guides.push({ axis: 'y', at: s, from: x, to: x + w })
  }
  if (handle.includes('n')) {
    const s = near(y, vy)
    if (s !== null) (h = h + y - s), (y = s), guides.push({ axis: 'y', at: s, from: x, to: x + w })
  }
  return { box: [x, y, Math.max(1, w), Math.max(1, h)], guides }
}

function dedupe(g: Guide[]): Guide[] {
  const seen = new Map<string, Guide>()
  for (const x of g) {
    const k = `${x.axis}${Math.round(x.at)}`
    const old = seen.get(k)
    if (!old) seen.set(k, { ...x })
    else (old.from = Math.min(old.from, x.from)), (old.to = Math.max(old.to, x.to))
  }
  return [...seen.values()]
}

/** Line items up: their left (or center, right, top, middle, bottom) on the selection's. */
export function alignBoxes(boxes: { id: string; r: Rect }[], how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): Record<string, [number, number]> {
  const xs = boxes.map((b) => b.r)
  const L = Math.min(...xs.map((r) => r.x))
  const R = Math.max(...xs.map((r) => r.x + r.w))
  const T = Math.min(...xs.map((r) => r.y))
  const B = Math.max(...xs.map((r) => r.y + r.h))
  const out: Record<string, [number, number]> = {}
  for (const { id, r } of boxes) {
    let dx = 0
    let dy = 0
    if (how === 'left') dx = L - r.x
    if (how === 'center') dx = (L + R) / 2 - (r.x + r.w / 2)
    if (how === 'right') dx = R - (r.x + r.w)
    if (how === 'top') dy = T - r.y
    if (how === 'middle') dy = (T + B) / 2 - (r.y + r.h / 2)
    if (how === 'bottom') dy = B - (r.y + r.h)
    out[id] = [Math.round(dx), Math.round(dy)]
  }
  return out
}

/** Even gaps between three or more items, along x or y. Returns how far each moves. */
export function distributeBoxes(boxes: { id: string; r: Rect }[], axis: 'x' | 'y'): Record<string, [number, number]> {
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y)
  const size = (r: Rect) => (axis === 'x' ? r.w : r.h)
  const sorted = [...boxes].sort((a, b) => pos(a.r) - pos(b.r))
  const out: Record<string, [number, number]> = {}
  if (sorted.length < 3) return out
  const first = sorted[0].r
  const last = sorted[sorted.length - 1].r
  const span = pos(last) + size(last) - pos(first)
  const gap = (span - sorted.reduce((n, b) => n + size(b.r), 0)) / (sorted.length - 1)
  let at = pos(first)
  for (const b of sorted) {
    const d = Math.round(at - pos(b.r))
    out[b.id] = axis === 'x' ? [d, 0] : [0, d]
    at += size(b.r) + gap
  }
  return out
}
