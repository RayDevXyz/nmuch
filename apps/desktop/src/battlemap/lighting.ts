import * as Y from 'yjs'
import type { Element, Light, PropEl, TokenEl } from '../edgeless/model'
import { builtinById } from './props'
import { LIGHT_PRESETS } from './tools'
import { blockers, type Built } from './model'
import { ellipseRing, intersect, sightArea, tidy, unionAll, unite, type Multi, type Pt, type Seg } from './geom'

/**
 * Light and sight on a battle map. Walls and shut doors block both; windows, half walls and bars
 * let them through. Lights come from light elements, props that give light and tokens carrying
 * one. Players see what their characters see: within their sight, and (in the dark) only where
 * it's lit or within their darkvision. Where they have been is remembered, shown dimmed.
 */

export interface Grid {
  size: number
  feet: number
}
export const ftToPx = (ft: number, g: Grid) => (ft / (g.feet || 5)) * g.size

export interface LitSource {
  id: string
  x: number
  y: number
  /** Radii in world pixels. */
  bright: number
  dim: number
  color: string
  flicker: boolean
  /** Where its light falls (walls cast shadows). */
  area: Multi
  /** Its owner is hidden from players: its light isn't sent. */
  secret: boolean
}

const centerOf = (xywh: [number, number, number, number]): Pt => [xywh[0] + xywh[2] / 2, xywh[1] + xywh[3] / 2]

/** A prop's light: its own, else its kind's (a brazier glows). */
export function propLight(p: PropEl): Light | null {
  if (p.light) return p.light
  const def = p.asset.startsWith('b:') ? builtinById.get(p.asset.slice(2)) : undefined
  return def?.light ? LIGHT_PRESETS[def.light]?.light ?? null : null
}

/** Every light on the map with where it falls. */
export function lights(elements: Element[], walls: Seg[], g: Grid, hiddenLayers: Set<string>): LitSource[] {
  const out: LitSource[] = []
  for (const e of elements) {
    if (e.visible === false || hiddenLayers.has(e.layer ?? '')) continue
    let l: Light | null = null
    let secret = false
    if (e.type === 'light') l = e.light
    else if (e.type === 'prop') (l = propLight(e)), (secret = e.layer === 'gm')
    else if (e.type === 'token') (l = e.light ?? null), (secret = !!e.hidden)
    if (!l || l.on === false || !('xywh' in e)) continue
    const [x, y] = centerOf(e.xywh)
    const bright = ftToPx(l.bright, g)
    const dim = ftToPx(l.dim, g)
    if (bright + dim <= 0) continue
    // A cone turns with its prop.
    const cone = l.cone ? { dir: l.cone.dir + (e.type === 'prop' ? (e.rotate ?? 0) : 0), angle: l.cone.angle } : undefined
    out.push({ id: e.id, x, y, bright, dim, color: l.color || '#ffd28a', flicker: !!l.flicker, area: sightArea([x, y], walls, bright + dim, cone), secret })
  }
  return out
}

export interface Vision {
  /** What the party sees now. */
  visible: Multi
  /** Each player token's own view (to tell which creatures they see). */
  byToken: Record<string, Multi>
}

/** What the player characters see, given the light. */
export function vision(elements: Element[], walls: Seg[], lit: LitSource[], ambient: 'day' | 'dusk' | 'dark', g: Grid, far: number): Vision {
  const party = elements.filter((e): e is TokenEl => e.type === 'token' && !!e.player && !e.hidden && e.visible !== false)
  const litArea = ambient === 'dark' ? unionAll(lit.map((l) => l.area)) : []
  const byToken: Record<string, Multi> = {}
  for (const t of party) {
    const o = centerOf(t.xywh)
    const range = t.sight ? ftToPx(t.sight, g) : far
    let seen = sightArea(o, walls, range)
    if (ambient === 'dark') {
      const dv = t.darkvision ? sightArea(o, walls, ftToPx(t.darkvision, g)) : []
      seen = intersect(seen, unite(litArea, dv))
    }
    // A character always knows the square it stands on.
    const r = Math.min(t.xywh[2], t.xywh[3]) / 2
    byToken[t.id] = unite(seen, [[ellipseRing(o[0], o[1], r, r, 16)]])
  }
  return { visible: unionAll(Object.values(byToken)), byToken }
}

/** The blocking segments of a built map. */
export const wallsOf = (b: Built) => blockers(b)

// ---------------------------------------------------------------- explored memory, kept in the page

const STATE = 'mapState'
export function readExplored(doc: Y.Doc): Multi {
  const v = (doc.getMap(STATE) as Y.Map<unknown>).get('explored')
  return Array.isArray(v) ? (v as Multi) : []
}
/** Add what is seen now to what has been explored (only when it grows). */
export function remember(doc: Y.Doc, seen: Multi) {
  if (!seen.length) return
  const before = readExplored(doc)
  const after = tidy(unite(before, tidy(seen, 2)), 2)
  if (JSON.stringify(after) === JSON.stringify(before)) return
  doc.transact(() => (doc.getMap(STATE) as Y.Map<unknown>).set('explored', after), 'map-state')
}
export function forget(doc: Y.Doc) {
  doc.transact(() => (doc.getMap(STATE) as Y.Map<unknown>).delete('explored'), 'map-state')
}

// ---------------------------------------------------------------- drawing light (DM and players do the same)

const ringPath = (ctx: CanvasRenderingContext2D, m: Multi) => {
  for (const poly of m)
    for (const ring of poly) {
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
    }
}

/**
 * Darkness over `box` with light cut out of it, tinted by the lights' colours. `strength` is how
 * dark the unlit parts are (the DM sees through them). `t` is the time, for flickering.
 */
export function drawLight(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, lit: LitSource[], ambient: 'day' | 'dusk' | 'dark', strength: number, t: number) {
  const dark = ambient === 'dark' ? 0.92 : ambient === 'dusk' ? 0.5 : 0
  if (dark > 0) {
    ctx.save()
    ctx.fillStyle = `rgba(6,8,14,${dark * strength})`
    ctx.fillRect(box.x, box.y, box.w, box.h)
    ctx.globalCompositeOperation = 'destination-out'
    for (const l of lit) {
      const f = l.flicker ? 1 + Math.sin(t / 90 + l.x) * 0.03 + Math.sin(t / 37 + l.y) * 0.025 : 1
      const R = (l.bright + l.dim) * f
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, R)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(Math.min(0.98, (l.bright * f) / R), 'rgba(0,0,0,1)')
      g.addColorStop(Math.min(0.99, (l.bright * f) / R + 0.01), 'rgba(0,0,0,.55)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.save()
      ctx.beginPath()
      ringPath(ctx, l.area)
      ctx.clip('evenodd')
      ctx.fillStyle = g
      ctx.fillRect(l.x - R, l.y - R, R * 2, R * 2)
      ctx.restore()
    }
    ctx.restore()
  }
  // The lights' colour, gently.
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const l of lit) {
    const f = l.flicker ? 0.85 + Math.sin(t / 70 + l.x * 0.3) * 0.1 + Math.sin(t / 23 + l.y) * 0.05 : 1
    const R = l.bright + l.dim
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, R)
    const a = (ambient === 'day' ? 0.08 : 0.22) * f
    g.addColorStop(0, hexA(l.color, a))
    g.addColorStop(1, hexA(l.color, 0))
    ctx.save()
    ctx.beginPath()
    ringPath(ctx, l.area)
    ctx.clip('evenodd')
    ctx.fillStyle = g
    ctx.fillRect(l.x - R, l.y - R, R * 2, R * 2)
    ctx.restore()
  }
  ctx.restore()
}

function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0xffd28a
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Fog for players' sight: black where never seen, dimmed where explored, clear where seen. */
export function drawSight(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, visible: Multi, explored: Multi, strength: number) {
  ctx.save()
  ctx.fillStyle = `rgba(4,4,6,${strength})`
  ctx.fillRect(box.x, box.y, box.w, box.h)
  ctx.globalCompositeOperation = 'destination-out'
  if (explored.length) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'
    ctx.beginPath()
    ringPath(ctx, explored)
    ctx.fill('evenodd')
  }
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ringPath(ctx, visible)
  ctx.fill('evenodd')
  ctx.restore()
}
