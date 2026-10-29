import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { uid } from '../lib/id'
import { keyBetween } from '../lib/fractional'
import type { NoteRef } from '../lib/core/page-sync'

/**
 * The edgeless canvas's data, read from and written to the page's Y.Doc. The layout is the
 * contract in `crates/bw-core/src/surface.rs`: one `Y.Map` per element in the `surface` map,
 * one entry per field, so concurrent edits to different fields merge.
 */

export type XYWH = [number, number, number, number]
export type ShapeKind = 'rect' | 'ellipse' | 'diamond'
export type End = { id: string } | { point: [number, number] }

interface Base {
  id: string
  index: string
  text?: string
}
export interface ShapeEl extends Base {
  type: 'shape'
  xywh: XYWH
  shape: ShapeKind
  fill?: string
  stroke?: string
}
export interface TextEl extends Base {
  type: 'text'
  xywh: XYWH
  fontSize?: number
  color?: string
}
export interface ConnectorEl extends Base {
  type: 'connector'
  source: End
  target: End
  stroke?: string
}
export interface FrameEl extends Base {
  type: 'frame'
  xywh: XYWH
  fill?: string
}
export type Element = ShapeEl | TextEl | ConnectorEl | FrameEl
export type Boxed = ShapeEl | TextEl | FrameEl
/** An element before it has an id and a place in the stacking order. */
export type NewElement = Element extends infer E ? (E extends Element ? Omit<E, 'id' | 'index'> & { index?: string } : never) : never

/** A note as the canvas sees it. `xywh[3]` is a minimum height: notes grow with their text. */
export interface CanvasNote {
  id: string
  ref: NoteRef
  xywh: XYWH | null
  display: 'both' | 'edgeless'
}

/** Changes made on the canvas: what canvas undo tracks (note text has its own undo). */
export const CANVAS = { canvas: true }

export const COLORS: Record<string, string> = {
  gray: '#9b9a97',
  brown: '#a27763',
  orange: '#e9883c',
  yellow: '#e3b341',
  green: '#4fae6f',
  blue: '#4f8fd8',
  purple: '#9a6dd7',
  pink: '#d667a6',
  red: '#e05a55',
}
export const colorOf = (name: string | undefined, fallback = 'var(--muted-foreground)') => (name && COLORS[name]) || fallback
/** Fills are tints of the color, so the same name works on light and dark backgrounds. */
export const fillOf = (name: string | undefined) =>
  name && COLORS[name] ? `color-mix(in srgb, ${COLORS[name]} 24%, var(--editor-bg))` : 'var(--panel)'

const surfaceOf = (doc: Y.Doc) => doc.getMap('surface') as Y.Map<Y.Map<unknown>>
const notesOf = (doc: Y.Doc) => doc.getMap('notes') as Y.Map<Y.Map<unknown>>

function isXYWH(v: unknown): v is XYWH {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}

export function readElements(doc: Y.Doc): Element[] {
  const out: Element[] = []
  surfaceOf(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map)) return
    const el = { ...m.toJSON(), id } as Element
    if (el.type === 'connector') {
      if (el.source && el.target) out.push(el)
    } else if ((el.type === 'shape' || el.type === 'text' || el.type === 'frame') && isXYWH(el.xywh)) {
      out.push(el)
    }
  })
  return out.sort((a, b) => (a.index === b.index ? (a.id < b.id ? -1 : 1) : a.index < b.index ? -1 : 1))
}

export function readNotes(notes: NoteRef[], doc: Y.Doc): CanvasNote[] {
  const map = notesOf(doc)
  return notes.map((ref) => {
    const m = map.get(ref.id)
    const xywh = m?.get('xywh')
    return { id: ref.id, ref, xywh: isXYWH(xywh) ? xywh : null, display: m?.get('display') === 'edgeless' ? 'edgeless' : 'both' }
  })
}

/** The surface's elements, re-read on every change to them. */
export function useElements(doc: Y.Doc | null): Element[] {
  const [els, setEls] = useState<Element[]>([])
  useEffect(() => {
    if (!doc) return
    const s = surfaceOf(doc)
    const update = () => setEls(readElements(doc))
    update()
    s.observeDeep(update)
    return () => s.unobserveDeep(update)
  }, [doc])
  return els
}

// ---- writing (always in a CANVAS transaction, so canvas undo sees it)

export function addElement(doc: Y.Doc, fields: NewElement): string {
  const id = uid()
  const els = readElements(doc)
  // Frames go to the back, everything else on top.
  const index =
    fields.index ??
    (fields.type === 'frame' ? keyBetween(null, els[0]?.index || null) : keyBetween(els[els.length - 1]?.index || null, null))
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    surfaceOf(doc).set(id, m)
    for (const [k, v] of Object.entries({ ...fields, id, index })) if (v !== undefined) m.set(k, v)
  }, CANVAS)
  return id
}

export function updateElements(doc: Y.Doc, patches: Record<string, Record<string, unknown>>) {
  doc.transact(() => {
    for (const [id, patch] of Object.entries(patches)) {
      const m = surfaceOf(doc).get(id)
      if (m instanceof Y.Map) for (const [k, v] of Object.entries(patch)) (v === undefined ? m.delete(k) : m.set(k, v))
    }
  }, CANVAS)
}

export function setNoteLayout(doc: Y.Doc, layouts: Record<string, { xywh?: XYWH; display?: 'both' | 'edgeless' }>) {
  doc.transact(() => {
    for (const [id, l] of Object.entries(layouts)) {
      const m = notesOf(doc).get(id)
      if (!(m instanceof Y.Map)) continue
      if (l.xywh) m.set('xywh', l.xywh)
      if (l.display) m.set('display', l.display)
    }
  }, CANVAS)
}

/** A new note at `xywh`, after the existing ones in doc order. Returns its id. */
export function addNote(doc: Y.Doc, xywh: XYWH, display: 'both' | 'edgeless'): string {
  const id = uid()
  const notes = notesOf(doc)
  let last = ''
  notes.forEach((m) => {
    const o = String(m.get('order') ?? '')
    if (o > last) last = o
  })
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    notes.set(id, m)
    m.set('id', id)
    m.set('order', keyBetween(last || null, null))
    m.set('xywh', xywh)
    m.set('display', display)
    const content = new Y.XmlFragment()
    m.set('content', content)
    const p = new Y.XmlElement('paragraph')
    p.setAttribute('id', uid())
    content.insert(0, [p])
  }, CANVAS)
  return id
}

/** Delete elements and notes (a page keeps at least one note); connectors attached to them go too. */
export function deleteItems(doc: Y.Doc, ids: Set<string>) {
  const surface = surfaceOf(doc)
  const notes = notesOf(doc)
  doc.transact(() => {
    for (const el of readElements(doc)) {
      if (ids.has(el.id)) surface.delete(el.id)
      else if (el.type === 'connector' && [el.source, el.target].some((e) => 'id' in e && ids.has(e.id))) surface.delete(el.id)
    }
    for (const id of ids) if (notes.has(id) && notes.size > 1) notes.delete(id)
  }, CANVAS)
}

export function undoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager([surfaceOf(doc), notesOf(doc)], { trackedOrigins: new Set([CANVAS]), captureTimeout: 400 })
}

// ---- geometry

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export const rectOf = ([x, y, w, h]: XYWH): Rect => ({ x, y, w, h })
export const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2]
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
export const normRect = (x1: number, y1: number, x2: number, y2: number): Rect => ({
  x: Math.min(x1, x2),
  y: Math.min(y1, y2),
  w: Math.abs(x2 - x1),
  h: Math.abs(y2 - y1),
})
export function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}

/**
 * Where the line from the center of `r` towards `toward` leaves the outline, so connectors
 * stop at the edge of a shape instead of its middle.
 */
export function edgePoint(r: Rect, shape: ShapeKind | 'box', toward: [number, number]): [number, number] {
  const [cx, cy] = center(r)
  const dx = toward[0] - cx
  const dy = toward[1] - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const a = r.w / 2
  const b = r.h / 2
  let t: number
  if (shape === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (a * a || 1) + (dy * dy) / (b * b || 1))
  else if (shape === 'diamond') t = 1 / (Math.abs(dx) / (a || 1) + Math.abs(dy) / (b || 1))
  else t = Math.min(a / Math.abs(dx || 1e-9), b / Math.abs(dy || 1e-9))
  return [cx + dx * t, cy + dy * t]
}
