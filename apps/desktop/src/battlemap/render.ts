import type { WallEl } from '../edgeless/model'
import { linePath, pathOf, type Multi, type Pt } from './geom'
import { FLOORS, materialOf, TERRAIN, type Built, type Material, type ThemeId } from './model'

/**
 * Drawing a battle map's structure as SVG markup, in a theme. The same markup is what the DM
 * sees (with hit areas to select things) and what players get (as a picture, without anything
 * only the DM may see). Coordinates are world coordinates.
 */

export interface Look {
  /** Outside the floor. */
  ground: string
  wall: string
  wallW: number
  /** Where a door or window cuts the wall. */
  gap: string
  door: string
  /** The band of hatching or rock drawn around the floor (0: none). */
  hatch: number
  hatchKind: 'ink' | 'rock' | 'none'
  shadow: number
  line: string
  /** CSS filter for props, so a library prop matches the theme. */
  propFilter: string
}

export function lookOf(theme: ThemeId, grid: number): Look {
  const w = Math.max(4, Math.round(grid * 0.14))
  switch (theme) {
    case 'ink':
      return { ground: '#fbfaf5', wall: '#111111', wallW: w, gap: '#fbfaf5', door: '#fbfaf5', hatch: grid * 0.55, hatchKind: 'ink', shadow: 0, line: '#111111', propFilter: 'grayscale(1) contrast(1.6) brightness(1.15)' }
    case 'blueprint':
      return { ground: '#173f73', wall: '#eaf3ff', wallW: Math.max(3, w * 0.6), gap: '#245594', door: '#245594', hatch: 0, hatchKind: 'none', shadow: 0, line: '#eaf3ff', propFilter: 'grayscale(1) brightness(1.8) sepia(1) hue-rotate(170deg) saturate(2.5)' }
    case 'modern':
      return { ground: '#2a2d33', wall: '#1b1d21', wallW: w, gap: '#eeebe4', door: '#c9a77c', hatch: 0, hatchKind: 'none', shadow: grid * 0.18, line: '#1b1d21', propFilter: 'saturate(0.6)' }
    default:
      return { ground: '#24211d', wall: '#3b352e', wallW: w * 1.3, gap: '#a39a8c', door: '#8a5a32', hatch: grid * 0.5, hatchKind: 'rock', shadow: grid * 0.35, line: '#2a251f', propFilter: '' }
  }
}

/** A material's flat colour in a theme. */
function flat(m: Material, theme: ThemeId, terrain: boolean): [string, string] {
  if (theme === 'ink') {
    if (m === TERRAIN.water || m === TERRAIN.deep || m === TERRAIN.ice) return ['#eef1f3', '#7e8a93']
    if (m === TERRAIN.lava) return ['#e2ded6', '#555555']
    if (m === TERRAIN.pit) return ['#1a1a1a', '#000000']
    if (terrain) return ['#f3f1ea', '#9a978f']
    return ['#ffffff', '#c9c6be']
  }
  if (theme === 'blueprint') {
    if (m === TERRAIN.water || m === TERRAIN.deep) return ['#1e4f8a', '#7fb2ec']
    if (m === TERRAIN.pit) return ['#0e2a52', '#0e2a52']
    if (m === TERRAIN.lava) return ['#3a4f8a', '#b8c9ff']
    return terrain ? ['#1d4a82', '#5d8ed0'] : ['#245594', '#3f78bf']
  }
  if (theme === 'modern') {
    if (terrain) return [m.color, m.dark]
    return ['#eeebe4', '#dcd8cf']
  }
  return [m.color, m.dark]
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The tile a material is filled with. */
function pattern(id: string, m: Material, theme: ThemeId, terrain: boolean, grid: number): string {
  const [base, dark] = flat(m, theme, terrain)
  const s = grid
  const texture = theme === 'modern' ? 'none' : theme === 'blueprint' ? (m.texture === 'waves' ? 'waves' : 'none') : m.texture
  let inner = ''
  switch (texture) {
    case 'tiles':
      inner = `<path d="M0,0H${s}V${s}" fill="none" stroke="${dark}" stroke-width="${s * 0.025}" opacity=".7"/><path d="M${s / 2},0V${s}M0,${s / 2}H${s}" stroke="${dark}" stroke-width="${s * 0.015}" opacity=".35"/>`
      break
    case 'planks': {
      const h = s / 4
      for (let i = 0; i < 4; i++) {
        const y = i * h
        const off = ((i * 37) % 3) * (s / 3)
        inner += `<path d="M0,${y}H${s}M${off},${y}V${y + h}" stroke="${dark}" stroke-width="${s * 0.018}" opacity=".75"/>`
        inner += `<path d="M${(off + s * 0.45) % s},${y + h * 0.5}h${s * 0.12}" stroke="${dark}" stroke-width="${s * 0.008}" opacity=".5"/>`
      }
      break
    }
    case 'flags':
      inner = `<path d="M0,${s * 0.42}L${s * 0.36},${s * 0.38}L${s * 0.62},${s * 0.46}L${s},${s * 0.4}M${s * 0.36},${s * 0.38}L${s * 0.3},0M${s * 0.62},${s * 0.46}L${s * 0.7},${s}M${s * 0.18},${s * 0.4}L${s * 0.12},${s}M${s * 0.85},${s * 0.42}L${s * 0.92},0" fill="none" stroke="${dark}" stroke-width="${s * 0.02}" opacity=".7"/>`
      break
    case 'noise': {
      let d = ''
      for (let i = 0; i < 14; i++) {
        const x = ((i * 53) % 97) / 97
        const y = ((i * 31) % 89) / 89
        const r = 0.02 + ((i * 7) % 5) * 0.012
        d += `<circle cx="${(x * s).toFixed(1)}" cy="${(y * s).toFixed(1)}" r="${(r * s).toFixed(1)}"/>`
      }
      inner = `<g fill="${dark}" opacity=".55">${d}</g>`
      break
    }
    case 'speckle': {
      let d = ''
      for (let i = 0; i < 22; i++) {
        const x = ((i * 41) % 101) / 101
        const y = ((i * 67) % 103) / 103
        d += `<rect x="${(x * s).toFixed(1)}" y="${(y * s).toFixed(1)}" width="${(s * 0.025).toFixed(1)}" height="${(s * 0.05).toFixed(1)}" transform="rotate(${(i * 23) % 50 - 25} ${(x * s).toFixed(1)} ${(y * s).toFixed(1)})"/>`
      }
      inner = `<g fill="${dark}" opacity=".6">${d}</g>`
      break
    }
    case 'waves':
      inner = `<path d="M0,${s * 0.3}q${s / 8},-${s / 12} ${s / 4},0t${s / 4},0t${s / 4},0t${s / 4},0M0,${s * 0.75}q${s / 8},-${s / 12} ${s / 4},0t${s / 4},0t${s / 4},0t${s / 4},0" fill="none" stroke="${dark}" stroke-width="${s * 0.02}" opacity=".7"/>`
      break
  }
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}"><rect width="${s}" height="${s}" fill="${base}"/>${inner}</pattern>`
}

export interface RenderOpts {
  theme: ThemeId
  grid: number
  /** Prefix for ids (several maps can be on screen). */
  idp: string
  /** The DM's view: hit areas, carved shapes' outlines, secret doors marked. */
  dm: boolean
  /** Selected ids (DM): outlined. */
  selected?: Set<string>
}

/** The terrain layer's vector part (pictures are drawn apart). */
export function renderTerrain(b: Built, o: RenderOpts): { defs: string; body: string } {
  const used = new Set(b.terrain.map((t) => t.material))
  const defs = [...used].map((m) => pattern(`${o.idp}-t-${m}`, TERRAIN[m] ?? TERRAIN.grass, o.theme, true, o.grid)).join('')
  let body = ''
  for (const t of b.terrain) {
    const d = pathOf(t.geom)
    if (!d) continue
    const edge = o.theme === 'ink' ? `stroke="#55534e" stroke-width="${o.grid * 0.03}"` : `stroke="${(TERRAIN[t.material] ?? TERRAIN.grass).dark}" stroke-opacity=".45" stroke-width="${o.grid * 0.03}"`
    body += `<path d="${d}" fill-rule="evenodd" fill="url(#${o.idp}-t-${t.material})" ${edge}/>`
    if (o.dm) body += `<path d="${d}" fill-rule="evenodd" class="bm-hit${o.selected?.has(t.id) ? ' selected' : ''}" data-cid="${esc(t.id)}"/>`
  }
  return { defs, body }
}

/** The architecture layer: floors, the auto-styled walls around them, walls, doors and the rest. */
export function renderArchitecture(b: Built, o: RenderOpts, carves: { id: string; geom: Multi }[] = []): { defs: string; body: string } {
  const look = lookOf(o.theme, o.grid)
  const used = new Set(b.floors.map((f) => f.material))
  const p = o.idp
  let defs = [...used].map((m) => pattern(`${p}-f-${m}`, FLOORS[m] ?? FLOORS.stone, o.theme, false, o.grid)).join('')
  const floorD = pathOf(b.floor)
  let body = ''
  if (floorD) {
    defs += `<clipPath id="${p}-floor"><path d="${floorD}" clip-rule="evenodd"/></clipPath>`
    // Around the floor: hatching (ink) or rough rock (stone).
    if (look.hatch > 0) {
      defs += `<mask id="${p}-band" maskUnits="userSpaceOnUse" x="-1e6" y="-1e6" width="2e6" height="2e6"><path d="${floorD}" fill="none" stroke="#fff" stroke-width="${look.hatch * 2}" stroke-linejoin="round"/><path d="${floorD}" fill-rule="evenodd" fill="#000"/></mask>`
      if (look.hatchKind === 'ink') {
        const s = o.grid / 5
        defs += `<pattern id="${p}-hatch" patternUnits="userSpaceOnUse" width="${s}" height="${s}" patternTransform="rotate(35)"><path d="M0,${s / 2}H${s}" stroke="#111" stroke-width="${s * 0.16}"/></pattern>`
        defs += `<pattern id="${p}-hatch2" patternUnits="userSpaceOnUse" width="${s * 2.2}" height="${s * 2.2}" patternTransform="rotate(-50)"><path d="M0,${s}H${s * 2.2}" stroke="#111" stroke-width="${s * 0.12}"/></pattern>`
        body += `<g mask="url(#${p}-band)"><path d="${floorD}" fill="none" stroke="url(#${p}-hatch)" stroke-width="${look.hatch * 2}"/><path d="${floorD}" fill="none" stroke="url(#${p}-hatch2)" stroke-width="${look.hatch * 1.1}" opacity=".8"/></g>`
      } else {
        defs += pattern(`${p}-rock`, { label: '', color: '#3a342d', dark: '#26221d', texture: 'noise' }, 'stone', true, o.grid)
        body += `<path d="${floorD}" fill="none" stroke="url(#${p}-rock)" stroke-width="${look.hatch * 2}" stroke-linejoin="round" mask="url(#${p}-band)"/>`
      }
    }
    // The floor, each shape in its material.
    body += `<g clip-path="url(#${p}-floor)">`
    for (const f of b.floors) body += `<path d="${pathOf(f.geom)}" fill-rule="evenodd" fill="url(#${p}-f-${f.material})"/>`
    if (o.theme === 'blueprint') {
      // Blueprint paper: a fine grid.
      const s = o.grid / 2
      defs += `<pattern id="${p}-bp" patternUnits="userSpaceOnUse" width="${s}" height="${s}"><path d="M${s},0V${s}H0" fill="none" stroke="#eaf3ff" stroke-opacity=".14" stroke-width="1"/></pattern>`
      body += `<path d="${floorD}" fill-rule="evenodd" fill="url(#${p}-bp)"/>`
    }
    // A soft shadow cast inwards by the walls.
    if (look.shadow > 0) {
      defs += `<filter id="${p}-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${look.shadow / 2.5}"/></filter>`
      body += `<path d="${floorD}" fill="none" stroke="#000" stroke-opacity="${o.theme === 'modern' ? 0.18 : 0.45}" stroke-width="${look.shadow * 2}" filter="url(#${p}-blur)"/>`
    }
    body += `</g>`
    body += `<path d="${floorD}" fill="none" stroke="${look.wall}" stroke-width="${look.wallW}" stroke-linejoin="round"/>`
  }
  // Walls drawn on their own.
  for (const w of b.walls) {
    body += `<path d="${linePath(w.line)}" fill="none" stroke="${look.wall}" stroke-width="${look.wallW}" stroke-linecap="square" stroke-linejoin="round"/>`
  }
  for (const op of b.openings) body += opening(op.el, op.line, look, o)
  // The DM's handles: carved shapes, and hit areas to select things by.
  if (o.dm) {
    for (const c of carves) {
      const d = pathOf(c.geom)
      if (!d) continue
      body += `<path d="${d}" fill-rule="evenodd" class="bm-carve${o.selected?.has(c.id) ? ' selected' : ''}" data-cid="${esc(c.id)}"/>`
    }
    for (const f of b.floors) body += `<path d="${pathOf(f.geom)}" fill-rule="evenodd" class="bm-hit${o.selected?.has(f.id) ? ' selected' : ''}" data-cid="${esc(f.id)}"/>`
    for (const w of [...b.walls, ...b.openings]) body += `<path d="${linePath(w.line)}" class="bm-wall-hit${o.selected?.has(w.el.id) ? ' selected' : ''}" data-cid="${esc(w.el.id)}"/>`
  }
  return { defs, body }
}

function opening(el: WallEl, line: Pt[], look: Look, o: RenderOpts): string {
  const kind = el.kind ?? 'wall'
  const d = linePath(line)
  const W = look.wallW
  // A secret door looks like wall to players until it's found (opened).
  if (kind === 'secret' && !el.open && !o.dm) return `<path d="${d}" fill="none" stroke="${look.wall}" stroke-width="${W}" stroke-linecap="square"/>`
  let out = `<path d="${d}" fill="none" stroke="${look.gap}" stroke-width="${W + 2}" stroke-linecap="butt"/>`
  const [a, b] = [line[0], line[line.length - 1]]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const ux = (b[0] - a[0]) / len
  const uy = (b[1] - a[1]) / len
  const nx = -uy
  const ny = ux
  const ink = look.line
  switch (kind) {
    case 'door':
    case 'secret':
      if (el.open) {
        // Swung open: the leaf stands out from its hinge.
        out += `<path d="M${a[0]},${a[1]}l${nx * len * 0.9},${ny * len * 0.9}" stroke="${ink}" stroke-width="${W * 0.45}" stroke-linecap="round"/>`
        out += `<path d="M${a[0] + nx * len * 0.9},${a[1] + ny * len * 0.9}A${len * 0.9},${len * 0.9} 0 0 1 ${a[0] + ux * len * 0.9},${a[1] + uy * len * 0.9}" fill="none" stroke="${ink}" stroke-width="${W * 0.12}" stroke-dasharray="${W * 0.5} ${W * 0.4}" opacity=".6"/>`
      } else {
        const t = W * 0.85
        out += `<path d="M${a[0] + ux * W * 0.2 + nx * t / 2},${a[1] + uy * W * 0.2 + ny * t / 2}l${ux * (len - W * 0.4)},${uy * (len - W * 0.4)}l${-nx * t},${-ny * t}l${-ux * (len - W * 0.4)},${-uy * (len - W * 0.4)}Z" fill="${look.door}" stroke="${ink}" stroke-width="${W * 0.18}"/>`
      }
      if (kind === 'secret' && o.dm) {
        const mx = (a[0] + b[0]) / 2
        const my = (a[1] + b[1]) / 2
        out += `<text x="${mx}" y="${my}" font-size="${W * 2.2}" font-family="Georgia,serif" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#c0392b" stroke="#fff" stroke-width="${W * 0.25}" paint-order="stroke">S</text>`
      }
      return out
    case 'window':
      return (
        out +
        `<path d="M${a[0] + nx * W * 0.3},${a[1] + ny * W * 0.3}L${b[0] + nx * W * 0.3},${b[1] + ny * W * 0.3}M${a[0] - nx * W * 0.3},${a[1] - ny * W * 0.3}L${b[0] - nx * W * 0.3},${b[1] - ny * W * 0.3}" stroke="${ink}" stroke-width="${W * 0.16}"/>` +
        `<path d="${d}" stroke="#9fd4f0" stroke-width="${W * 0.35}" opacity=".85"/>`
      )
    case 'half':
      return out + `<path d="${d}" stroke="${look.wall}" stroke-width="${W * 0.45}" stroke-linecap="square" opacity=".85"/>`
    case 'bars': {
      const n = Math.max(2, Math.round(len / (W * 1.2)))
      let dots = ''
      for (let i = 0; i <= n; i++) dots += `<circle cx="${a[0] + ux * (len * i) / n}" cy="${a[1] + uy * (len * i) / n}" r="${W * 0.28}"/>`
      return out + `<path d="${d}" stroke="${ink}" stroke-width="${W * 0.12}"/><g fill="${ink}">${dots}</g>`
    }
  }
  return out
}

/** A standalone SVG document (for players), `w`×`h` world units from (x, y). */
export function svgDocument(defs: string, body: string, box: { x: number; y: number; w: number; h: number }, scale = 1): string {
  const { x, y, w, h } = box
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="${x} ${y} ${w} ${h}"><defs>${defs}</defs>${body}</svg>`
}
