import { useEffect, useState } from 'react'
import * as Y from 'yjs'

/**
 * A page's header (a cover): a gradient, a color or a picture behind the page's icon and title,
 * with its height, alignment and navigation. Kept in the page's Y.Doc (`header` map, one field
 * per setting), so it syncs and undoes like the rest of the page. Settings are plain values; the
 * CSS is built here, never stored.
 */

export type Background = 'gradient' | 'color' | 'image'
export type Align = 'left' | 'center' | 'right'
export type Place = 'top' | 'middle' | 'bottom'
export type Nav = 'none' | 'crumbs' | 'children' | 'both'

export interface HeaderSettings {
  on: boolean
  background: Background
  /** Gradient stops (2–3 #hex colors) and angle. */
  colors: string[]
  angle: number
  /** Solid background. */
  color: string
  /** A picture: a data:image/ URL (uploaded) or an http(s) address. */
  image: string
  /** Which part of the picture shows (0 = top, 100 = bottom). */
  focus: number
  /** Darken the background (0–0.8) and blur a picture (0–12 px). */
  dim: number
  blur: number
  /** Header height in px. */
  height: number
  align: Align
  place: Place
  /** Title size, as a share of the usual (0.6–1.8). */
  titleScale: number
  text: 'auto' | 'light' | 'dark'
  /** A line under the title. */
  subtitle: string
  showIcon: boolean
  nav: Nav
}

export const DEFAULT_HEADER: HeaderSettings = {
  on: true,
  background: 'gradient',
  colors: ['#7f5af0', '#2cb1bc'],
  angle: 135,
  color: '#2b2f3a',
  image: '',
  focus: 50,
  dim: 0,
  blur: 0,
  height: 240,
  align: 'left',
  place: 'bottom',
  titleScale: 1,
  text: 'auto',
  subtitle: '',
  showIcon: true,
  nav: 'crumbs',
}

export const GRADIENTS: { name: string; colors: string[]; angle: number }[] = [
  { name: 'Aurora', colors: ['#7f5af0', '#2cb1bc'], angle: 135 },
  { name: 'Sunset', colors: ['#ff7e5f', '#feb47b'], angle: 120 },
  { name: 'Ocean', colors: ['#0f2027', '#2c5364', '#4ca1af'], angle: 160 },
  { name: 'Forest', colors: ['#134e5e', '#71b280'], angle: 135 },
  { name: 'Dusk', colors: ['#2c3e50', '#fd746c'], angle: 135 },
  { name: 'Peach', colors: ['#ffecd2', '#fcb69f'], angle: 135 },
  { name: 'Mint', colors: ['#d4fc79', '#96e6a1'], angle: 120 },
  { name: 'Lavender', colors: ['#e0c3fc', '#8ec5fc'], angle: 135 },
  { name: 'Ember', colors: ['#200122', '#6f0000'], angle: 150 },
  { name: 'Night', colors: ['#141e30', '#243b55'], angle: 180 },
  { name: 'Candy', colors: ['#f857a6', '#ff5858'], angle: 135 },
  { name: 'Paper', colors: ['#f5f0e6', '#e6dccb'], angle: 180 },
]

const hex = (c: unknown, d: string) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d)
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d)
const one = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d)
export const safeImage = (v: unknown) =>
  typeof v === 'string' && (v.startsWith('data:image/') || /^https?:\/\/[^\s"'()<>]+$/.test(v)) && v.length < 12_000_000 ? v : ''

/** Settings as stored, checked and with defaults filled in; null: the page has no header. */
export function readHeader(doc: Y.Doc): HeaderSettings | null {
  const m = doc.getMap('header')
  if (m.get('on') !== true) return null
  const d = DEFAULT_HEADER
  const colors = Array.isArray(m.get('colors')) ? (m.get('colors') as unknown[]).map((c) => hex(c, '')).filter(Boolean).slice(0, 3) : []
  return {
    on: true,
    background: one(m.get('background'), ['gradient', 'color', 'image'] as const, d.background),
    colors: colors.length >= 2 ? colors : d.colors,
    angle: num(m.get('angle'), 0, 360, d.angle),
    color: hex(m.get('color'), d.color),
    image: safeImage(m.get('image')),
    focus: num(m.get('focus'), 0, 100, d.focus),
    dim: num(m.get('dim'), 0, 0.8, d.dim),
    blur: num(m.get('blur'), 0, 12, d.blur),
    height: num(m.get('height'), 100, 640, d.height),
    align: one(m.get('align'), ['left', 'center', 'right'] as const, d.align),
    place: one(m.get('place'), ['top', 'middle', 'bottom'] as const, d.place),
    titleScale: num(m.get('titleScale'), 0.6, 1.8, d.titleScale),
    text: one(m.get('text'), ['auto', 'light', 'dark'] as const, d.text),
    subtitle: typeof m.get('subtitle') === 'string' ? String(m.get('subtitle')).slice(0, 300) : '',
    showIcon: m.get('showIcon') !== false,
    nav: one(m.get('nav'), ['none', 'crumbs', 'children', 'both'] as const, d.nav),
  }
}

export function setHeader(doc: Y.Doc, patch: Partial<HeaderSettings>) {
  const m = doc.getMap('header')
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) m.set(k, v as never)
  })
}

export function addHeader(doc: Y.Doc, from: Partial<HeaderSettings> = {}) {
  setHeader(doc, { ...DEFAULT_HEADER, ...from, on: true })
}

export function removeHeader(doc: Y.Doc) {
  doc.getMap('header').set('on', false)
}

/** The page's header, re-read when it changes. */
export function useHeader(doc: Y.Doc | null | undefined): HeaderSettings | null {
  const [h, setH] = useState<HeaderSettings | null>(() => (doc ? readHeader(doc) : null))
  useEffect(() => {
    if (!doc) return setH(null)
    const m = doc.getMap('header')
    const update = () => setH(readHeader(doc))
    update()
    m.observe(update)
    return () => m.unobserve(update)
  }, [doc])
  return h
}

// ---- turning settings into looks

export function backgroundCss(h: HeaderSettings): React.CSSProperties {
  if (h.background === 'image' && h.image) {
    return { backgroundImage: `url(${JSON.stringify(h.image)})`, backgroundSize: 'cover', backgroundPosition: `50% ${h.focus}%` }
  }
  if (h.background === 'color') return { background: h.color }
  return { background: `linear-gradient(${h.angle}deg, ${h.colors.join(', ')})` }
}

function lum(c: string): number {
  const n = parseInt(c.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Light or dark text, whichever reads better on this background. */
export function textTone(h: HeaderSettings): 'light' | 'dark' {
  if (h.text !== 'auto') return h.text
  // Pictures are busy: light text, with the shadow and any dimming helping.
  if (h.background === 'image' && h.image) return 'light'
  const colors = h.background === 'color' ? [h.color] : h.colors
  const l = colors.reduce((s, c) => s + lum(c), 0) / colors.length
  const dimmed = l * (1 - h.dim)
  return dimmed > 0.4 ? 'dark' : 'light'
}

/** A picture for the header: scaled to at most 2400 px wide and kept small (JPEG). */
export async function headerImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('that is not a picture')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('the picture could not be read'))
      i.src = url
    })
    const scale = Math.min(1, 2400 / img.naturalWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}
