import { NoteEditor, type EditorHost } from '@brainwaves/editor'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { NoteRef } from '../lib/core/page-sync'
import { openPage } from '../state/actions'
import { setState, toast, useApp } from '../state/store'
import {
  addElement,
  addNote,
  CANVAS,
  center,
  colorOf,
  contains,
  deleteItems,
  edgePoint,
  fillOf,
  intersects,
  normRect,
  readNotes,
  rectOf,
  setNoteLayout,
  undoManager,
  union,
  updateElements,
  useElements,
  type Boxed,
  type CanvasNote,
  type ConnectorEl,
  type Element,
  type End,
  type NewElement,
  type Rect,
  type ShapeKind,
  type XYWH,
} from './model'
import { StyleBar, Toolbar, ZoomControls, type Tool } from './chrome'

/** The canvas viewport: world point (x, y) is at the top-left; `z` is the zoom. */
interface Viewport {
  x: number
  y: number
  z: number
}

const NOTE_W = 720
const MIN_Z = 0.1
const MAX_Z = 4
const LAYOUT = 'layout' // origin of automatic placement: not undoable

/** Viewports survive switching modes and tabs (for this session). */
const viewports = new Map<string, Viewport>()

/** Show a page's whole canvas: now if it's open, else the next time it opens. */
export function fitCanvas(pageId: string) {
  viewports.delete(pageId)
  window.dispatchEvent(new CustomEvent('bw-canvas-fit', { detail: pageId }))
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vp: Viewport }
  | { kind: 'move'; wx: number; wy: number; orig: Map<string, XYWH>; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; wx: number; wy: number; orig: XYWH; note: boolean }
  | { kind: 'marquee'; wx: number; wy: number; additive: string[] }
  | { kind: 'create'; tool: Tool; wx: number; wy: number }
  | { kind: 'connect'; source: End; wx: number; wy: number }

type Preview =
  | { kind: 'rect'; r: Rect; tool: Tool | 'marquee' }
  | { kind: 'line'; from: [number, number]; to: [number, number]; target: string | null }
  | null

export interface CanvasProps {
  pageId: string
  doc: Y.Doc
  notes: NoteRef[]
  host: EditorHost
  spellcheck: boolean
  onEditor: (noteId: string) => (e: TiptapEditor | null) => void
}

export function Canvas({ pageId, doc, notes: noteRefs, host, spellcheck, onEditor }: CanvasProps) {
  const root = useRef<HTMLDivElement>(null)
  const elements = useElements(doc)
  const notes = useNoteLayouts(doc, noteRefs)
  const [vp, setVp] = useState<Viewport>(() => viewports.get(pageId) ?? { x: -40, y: -40, z: 1 })
  const [selected, setSelected] = useState<string[]>([])
  const [tool, setToolState] = useState<Tool>('select')
  // Picking a drawing tool drops the selection (and its style bar).
  const setTool = useCallback((t: Tool) => {
    setToolState(t)
    if (t !== 'select' && t !== 'hand') setSelected([])
  }, [])
  const [editing, setEditing] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview>(null)
  const [presenting, setPresenting] = useState<number | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const gesture = useRef<Gesture | null>(null)
  const space = useRef(false)
  // Created in an effect (not a memo) so a remount in development gets a live one.
  const [um, setUm] = useState<Y.UndoManager | null>(null)
  const editors = useRef(new Map<string, TiptapEditor>())
  const focusNote = useRef<string | null>(null)

  useEffect(() => {
    const m = undoManager(doc)
    setUm(m)
    return () => m.destroy()
  }, [doc])
  useEffect(() => void viewports.set(pageId, vp), [pageId, vp])

  // ---------- geometry of everything on the canvas

  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements])
  const placedNotes = notes.filter((n) => n.xywh)
  const noteRect = useCallback(
    (n: CanvasNote): Rect => {
      const [x, y, w, h] = n.xywh!
      return { x, y, w, h: Math.max(h, heights[n.id] ?? 0) }
    },
    [heights],
  )
  const rectOfId = useCallback(
    (id: string): Rect | null => {
      const el = byId.get(id)
      if (el && el.type !== 'connector') return rectOf(el.xywh)
      const n = notes.find((x) => x.id === id)
      return n?.xywh ? noteRect(n) : null
    },
    [byId, notes, noteRect],
  )
  const frames = elements.filter((e): e is Extract<Element, { type: 'frame' }> => e.type === 'frame')

  // ---------- notes that were never placed go in a column below everything else

  useLayoutEffect(() => {
    const next = notes.find((n) => !n.xywh)
    if (!next) return
    const placed = union([...placedNotes.map(noteRect), ...elements.filter((e) => e.type !== 'connector').map((e) => rectOf((e as Boxed).xywh))])
    // Wait until the placed notes have been measured, so the column doesn't overlap.
    if (placedNotes.some((n) => heights[n.id] === undefined)) return
    const y = placed ? placed.y + placed.h + 40 : 0
    doc.transact(() => setNoteLayout(doc, { [next.id]: { xywh: [placed?.x ?? 0, y, NOTE_W, 80] } }), LAYOUT)
  }, [notes, placedNotes, heights, elements, doc, noteRect])

  // First visit: fit the content.
  const fitted = useRef(viewports.has(pageId))
  useEffect(() => {
    if (fitted.current || notes.some((n) => !n.xywh) || placedNotes.some((n) => heights[n.id] === undefined)) return
    fitted.current = true
    zoomToFit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, heights])

  // Someone (an import) asks to show the whole canvas again.
  useEffect(() => {
    const onFit = (e: Event) => {
      if ((e as CustomEvent<string>).detail === pageId) requestAnimationFrame(() => zoomToFit())
    }
    window.addEventListener('bw-canvas-fit', onFit)
    return () => window.removeEventListener('bw-canvas-fit', onFit)
  })

  // A search hit on this page's canvas: zoom to it and select it.
  const reveal = useApp((s) => s.reveal)
  useEffect(() => {
    if (!reveal || reveal.pageId !== pageId) return
    const r = rectOfId(reveal.blockId)
    if (!r) return
    setState({ reveal: null })
    fitted.current = true
    setSelected([reveal.blockId])
    fit({ x: r.x - 200, y: r.y - 150, w: r.w + 400, h: r.h + 300 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, pageId, elements])

  // ---------- coordinates

  const toWorld = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const b = root.current!.getBoundingClientRect()
      return [(clientX - b.left) / vp.z + vp.x, (clientY - b.top) / vp.z + vp.y]
    },
    [vp],
  )
  const toScreen = (r: Rect): Rect => ({ x: (r.x - vp.x) * vp.z, y: (r.y - vp.y) * vp.z, w: r.w * vp.z, h: r.h * vp.z })

  const fit = (r: Rect | null, pad = 60, maxZ = 1) => {
    const b = root.current?.getBoundingClientRect()
    if (!r || !b) return
    const z = Math.max(MIN_Z, Math.min(maxZ, (b.width - pad * 2) / (r.w || 1), (b.height - pad * 2) / (r.h || 1)))
    setVp({ z, x: r.x + r.w / 2 - b.width / 2 / z, y: r.y + r.h / 2 - b.height / 2 / z })
  }
  const allBounds = () =>
    union([...placedNotes.map(noteRect), ...elements.flatMap((e) => (e.type === 'connector' ? [] : [rectOf(e.xywh)]))])
  function zoomToFit() {
    fit(allBounds())
  }
  const zoomBy = (factor: number, at?: [number, number]) => {
    const b = root.current!.getBoundingClientRect()
    const [sx, sy] = at ?? [b.width / 2, b.height / 2]
    setVp((v) => {
      const z = Math.max(MIN_Z, Math.min(MAX_Z, v.z * factor))
      const wx = sx / v.z + v.x
      const wy = sy / v.z + v.y
      return { z, x: wx - sx / z, y: wy - sy / z }
    })
  }

  // Wheel: pan; with Ctrl/⌘ (and trackpad pinch): zoom at the cursor.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const b = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.0015), [e.clientX - b.left, e.clientY - b.top])
      else setVp((v) => ({ ...v, x: v.x + e.deltaX / v.z, y: v.y + e.deltaY / v.z }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // ---------- hit testing (by DOM: every item carries data-cid)

  const itemAt = (target: EventTarget | null): { id: string; part: string } | null => {
    const el = (target as HTMLElement | null)?.closest?.('[data-cid]') as HTMLElement | null
    return el ? { id: el.dataset.cid!, part: el.dataset.part ?? 'body' } : null
  }
  const itemAtPoint = (clientX: number, clientY: number): string | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const hit = (el as HTMLElement).closest?.('[data-cid]') as HTMLElement | null
      if (hit && hit.dataset.kind !== 'connector' && hit.dataset.part !== 'frame-body') return hit.dataset.cid!
      if (hit?.dataset.part === 'frame-body') return hit.dataset.cid!
    }
    return null
  }
  // Pointer capture retargets click/dblclick to the root, so those look up what's under the pointer.
  const itemUnder = (clientX: number, clientY: number) => itemAt(document.elementFromPoint(clientX, clientY))
  const isNote = (id: string) => notes.some((n) => n.id === id)

  // ---------- creating

  const create = (t: Tool, rect: Rect) => {
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }
    let id: string
    if (t === 'note') {
      id = addNote(doc, [r.x, r.y, Math.max(r.w, 240), 80], 'both')
      focusNote.current = id
    } else if (t === 'text') {
      id = addElement(doc, { type: 'text', xywh: [r.x, r.y, Math.max(r.w, 200), Math.max(r.h, 32)], text: '', fontSize: 20 })
      setEditing(id)
    } else if (t === 'frame') {
      id = addElement(doc, { type: 'frame', xywh: [r.x, r.y, Math.max(r.w, 160), Math.max(r.h, 120)], text: `Frame ${frames.length + 1}` })
    } else if (t === 'image') {
      // Ask for the picture; it's placed where the user clicked.
      pendingImage.current = { x: r.x, y: r.y }
      imageInput.current?.click()
      setTool('select')
      return
    } else if (t === 'pin') {
      const b = root.current!.getBoundingClientRect()
      setPinPicker({ wx: r.x, wy: r.y, sx: (r.x - vp.x) * vp.z + b.left, sy: (r.y - vp.y) * vp.z + b.top })
      setTool('select')
      return
    } else {
      const shape: ShapeKind = t === 'ellipse' ? 'ellipse' : t === 'diamond' ? 'diamond' : 'rect'
      id = addElement(doc, { type: 'shape', shape, xywh: [r.x, r.y, Math.max(r.w, 20), Math.max(r.h, 20)], fill: 'blue', stroke: 'blue', text: '' })
    }
    setSelected([id])
    setTool('select')
  }

  // Focus a note created on the canvas once its editor exists.
  const noteEditor = useCallback(
    (id: string) => {
      const forward = onEditor(id)
      return (e: TiptapEditor | null) => {
        forward(e)
        if (e) editors.current.set(id, e)
        else editors.current.delete(id)
        if (e && focusNote.current === id) {
          focusNote.current = null
          requestAnimationFrame(() => e.commands.focus('end'))
        }
      }
    },
    [onEditor],
  )
  // ---------- images and pins (world maps)

  const imageInput = useRef<HTMLInputElement>(null)
  const pendingImage = useRef<{ x: number; y: number } | null>(null)
  const [pinPicker, setPinPicker] = useState<{ wx: number; wy: number; sx: number; sy: number } | null>(null)
  const addImage = async (file: File) => {
    const at = pendingImage.current ?? { x: vp.x + 40, y: vp.y + 40 }
    pendingImage.current = null
    try {
      const { src, w, h } = await fitImage(file)
      const width = Math.min(w, 1600)
      const id = addElement(doc, { type: 'image', xywh: [Math.round(at.x), Math.round(at.y), width, Math.round((h / w) * width)], src, index: keyBefore() })
      setSelected([id])
    } catch (e) {
      toast(`Could not add the picture: ${String(e)}`)
    }
  }
  /** Pictures go under everything else (a map is a background). */
  const keyBefore = () => {
    const first = elements[0]?.index
    return first ? first.replace(/.$/, (c) => String.fromCharCode(Math.max(48, c.charCodeAt(0) - 1))) + 'V' : 'a0'
  }
  const pinPage = (wx: number, wy: number, page: string, title: string) => {
    const id = addElement(doc, { type: 'pin', xywh: [Math.round(wx - 14), Math.round(wy - 28), 28, 28], page, text: title, color: 'red' })
    setSelected([id])
  }

  const editorCallbacks = useRef(new Map<string, (e: TiptapEditor | null) => void>())
  const callbackFor = (id: string) => {
    let cb = editorCallbacks.current.get(id)
    if (!cb) editorCallbacks.current.set(id, (cb = noteEditor(id)))
    return cb
  }

  // ---------- pointer gestures

  const onPointerDown = (e: React.PointerEvent) => {
    if (presenting !== null) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const hit = itemAt(e.target)
    const middle = e.button === 1
    if (e.button !== 0 && !middle) return

    // Inside a note's text or a text box being edited: leave it to the editor.
    if (hit && hit.part === 'note-body' && tool === 'select' && !middle && !space.current) {
      if (!selected.includes(hit.id)) setSelected([hit.id])
      return
    }
    if ((e.target as HTMLElement).closest('textarea, .cv-stylebar, .cv-toolbar, .cv-zoom')) return

    root.current!.setPointerCapture(e.pointerId)
    if (middle || tool === 'hand' || space.current) {
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vp }
      return
    }
    setEditing(null)
    if (tool === 'connector') {
      const target = itemAtPoint(e.clientX, e.clientY)
      gesture.current = { kind: 'connect', source: target ? { id: target } : { point: [wx, wy] }, wx, wy }
      return
    }
    if (tool !== 'select') {
      gesture.current = { kind: 'create', tool, wx, wy }
      return
    }
    if (hit?.part === 'handle') {
      const id = selected[0]
      const n = notes.find((x) => x.id === id)
      const orig = n?.xywh ?? (byId.get(id) as Boxed | undefined)?.xywh
      if (orig) gesture.current = { kind: 'resize', id, handle: (e.target as HTMLElement).dataset.handle!, wx, wy, orig: [...orig] as XYWH, note: !!n }
      return
    }
    if (hit && hit.part !== 'frame-body') {
      const sel = e.shiftKey ? (selected.includes(hit.id) ? selected.filter((s) => s !== hit.id) : [...selected, hit.id]) : selected.includes(hit.id) ? selected : [hit.id]
      setSelected(sel)
      um?.stopCapturing()
      gesture.current = { kind: 'move', wx, wy, orig: movable(sel), moved: false }
      return
    }
    gesture.current = { kind: 'marquee', wx, wy, additive: e.shiftKey ? selected : [] }
    if (!e.shiftKey) setSelected([])
  }

  /** What moves with a selection: the items themselves, plus whatever sits inside a moved frame. */
  const movable = (sel: string[]): Map<string, XYWH> => {
    const out = new Map<string, XYWH>()
    const add = (id: string) => {
      const el = byId.get(id)
      if (el && el.type !== 'connector') out.set(id, [...el.xywh] as XYWH)
      const n = notes.find((x) => x.id === id)
      if (n?.xywh) out.set(id, [...n.xywh] as XYWH)
    }
    for (const id of sel) {
      add(id)
      const el = byId.get(id)
      if (el?.type === 'frame') {
        const f = rectOf(el.xywh)
        for (const other of elements) if (other.type !== 'connector' && other.id !== id && contains(f, rectOf(other.xywh))) add(other.id)
        for (const n of placedNotes) if (contains(f, noteRect(n))) add(n.id)
      }
    }
    return out
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    switch (g.kind) {
      case 'pan':
        setVp({ ...g.vp, x: g.vp.x - (e.clientX - g.sx) / g.vp.z, y: g.vp.y - (e.clientY - g.sy) / g.vp.z })
        return
      case 'move': {
        const dx = wx - g.wx
        const dy = wy - g.wy
        if (!g.moved && Math.hypot(dx, dy) * vp.z < 3) return
        g.moved = true
        const els: Record<string, Record<string, unknown>> = {}
        const ns: Record<string, { xywh: XYWH }> = {}
        g.orig.forEach(([x, y, w, h], id) => {
          const xywh: XYWH = [Math.round(x + dx), Math.round(y + dy), w, h]
          if (isNote(id)) ns[id] = { xywh }
          else els[id] = { xywh }
        })
        doc.transact(() => {
          updateElements(doc, els)
          setNoteLayout(doc, ns)
        }, CANVAS)
        return
      }
      case 'resize': {
        const [x, y, w, h] = g.orig
        const dx = wx - g.wx
        const dy = wy - g.wy
        let [nx, ny, nw, nh] = [x, y, w, h]
        if (g.handle.includes('e')) nw = w + dx
        if (g.handle.includes('w')) (nx = x + dx), (nw = w - dx)
        if (g.handle.includes('s')) nh = h + dy
        if (g.handle.includes('n')) (ny = y + dy), (nh = h - dy)
        const min = g.note ? 160 : 16
        if (nw < min) (nx = g.handle.includes('w') ? x + w - min : nx), (nw = min)
        if (nh < 16) (ny = g.handle.includes('n') ? y + h - 16 : ny), (nh = 16)
        const xywh: XYWH = [Math.round(nx), Math.round(ny), Math.round(nw), Math.round(nh)]
        if (g.note) setNoteLayout(doc, { [g.id]: { xywh: [xywh[0], y, xywh[2], h] } })
        else updateElements(doc, { [g.id]: { xywh } })
        return
      }
      case 'marquee': {
        const r = normRect(g.wx, g.wy, wx, wy)
        setPreview({ kind: 'rect', r, tool: 'marquee' })
        const inside = [
          ...elements.filter((el) => el.type !== 'connector' && el.type !== 'frame' && intersects(r, rectOf(el.xywh))).map((el) => el.id),
          ...frames.filter((f) => contains(r, rectOf(f.xywh))).map((f) => f.id),
          ...placedNotes.filter((n) => intersects(r, noteRect(n))).map((n) => n.id),
        ]
        setSelected([...new Set([...g.additive, ...inside])])
        return
      }
      case 'create':
        setPreview({ kind: 'rect', r: normRect(g.wx, g.wy, wx, wy), tool: g.tool })
        return
      case 'connect': {
        const target = itemAtPoint(e.clientX, e.clientY)
        const from = endPoint(g.source, [wx, wy])
        setPreview({ kind: 'line', from, to: [wx, wy], target: target && !('id' in g.source && g.source.id === target) ? target : null })
        return
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    setPreview(null)
    if (!g) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    if (g.kind === 'create') {
      const r = normRect(g.wx, g.wy, wx, wy)
      const clicked = r.w * vp.z < 6 && r.h * vp.z < 6
      const defaults: Partial<Record<Tool, [number, number]>> = { note: [NOTE_W / 2, 80], text: [200, 32], frame: [640, 400], rect: [160, 100], ellipse: [160, 100], diamond: [160, 120] }
      const [dw, dh] = defaults[g.tool] ?? [160, 100]
      create(g.tool, clicked ? { x: g.wx, y: g.wy, w: dw, h: dh } : r)
    } else if (g.kind === 'connect') {
      const target = itemAtPoint(e.clientX, e.clientY)
      const end: End = target && !('id' in g.source && g.source.id === target) ? { id: target } : { point: [wx, wy] }
      if (Math.hypot(wx - g.wx, wy - g.wy) * vp.z < 8 && !('id' in end)) return
      const id = addElement(doc, { type: 'connector', source: g.source, target: end, stroke: 'gray', text: '' })
      setSelected([id])
      setTool('select')
    } else if (g.kind === 'move' && !g.moved) {
      // A plain click on an already selected item narrows the selection to it.
      const hit = itemUnder(e.clientX, e.clientY)
      if (hit && !e.shiftKey) setSelected([hit.id])
    }
  }

  // ---------- connectors

  const endPoint = (end: End, toward: [number, number]): [number, number] => {
    if ('point' in end) return end.point
    const r = rectOfId(end.id)
    if (!r) return toward
    const el = byId.get(end.id)
    return edgePoint(r, el?.type === 'shape' ? el.shape : el?.type === 'pin' ? 'ellipse' : 'box', toward)
  }
  const connectorLine = (c: ConnectorEl): [[number, number], [number, number]] | null => {
    const anchor = (end: End): [number, number] | null => {
      if ('point' in end) return end.point
      const r = rectOfId(end.id)
      return r ? center(r) : null
    }
    const a = anchor(c.source)
    const b = anchor(c.target)
    if (!a || !b) return null
    return [endPoint(c.source, b), endPoint(c.target, a)]
  }

  // ---------- keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('.ProseMirror, textarea, input')) return
    const mod = e.ctrlKey || e.metaKey
    if (presenting !== null) {
      if (e.key === 'Escape') setPresenting(null)
      else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) present(Math.min(frames.length - 1, presenting + 1))
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) present(Math.max(0, presenting - 1))
      e.preventDefault()
      return
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) um?.redo()
      else um?.undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') return void (e.preventDefault(), um?.redo())
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      return setSelected([...elements.map((el) => el.id), ...placedNotes.map((n) => n.id)])
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      const copies = selected.flatMap((id) => {
        const el = byId.get(id)
        if (!el || el.type === 'connector') return []
        const { id: _, index: __, ...rest } = el
        const [x, y, w, h] = el.xywh
        return [addElement(doc, { ...rest, xywh: [x + 24, y + 24, w, h] } as NewElement)]
      })
      if (copies.length) setSelected(copies)
      return
    }
    if (mod && (e.key === '0' || e.key === '1')) return void (e.preventDefault(), zoomToFit())
    if (mod && (e.key === '=' || e.key === '+')) return void (e.preventDefault(), zoomBy(1.25))
    if (mod && e.key === '-') return void (e.preventDefault(), zoomBy(0.8))
    if (mod) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
      e.preventDefault()
      if (selected.filter(isNote).length >= notes.length) toast('A page keeps at least one note')
      deleteItems(doc, new Set(selected))
      setSelected([])
      return
    }
    if (e.key === 'Escape') return void (setSelected([]), setTool('select'))
    if (e.key === 'Enter' && selected.length === 1) {
      const id = selected[0]
      if (isNote(id)) editors.current.get(id)?.commands.focus('end')
      else setEditing(id)
      e.preventDefault()
      return
    }
    if (e.key.startsWith('Arrow') && selected.length) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0]
      const els: Record<string, Record<string, unknown>> = {}
      const ns: Record<string, { xywh: XYWH }> = {}
      movable(selected).forEach(([x, y, w, h], id) => {
        if (isNote(id)) ns[id] = { xywh: [x + dx, y + dy, w, h] }
        else els[id] = { xywh: [x + dx, y + dy, w, h] }
      })
      doc.transact(() => (updateElements(doc, els), setNoteLayout(doc, ns)), CANVAS)
      return
    }
    const keys: Record<string, Tool> = { v: 'select', h: 'hand', n: 'note', r: 'rect', o: 'ellipse', d: 'diamond', t: 'text', c: 'connector', f: 'frame', i: 'image', p: 'pin' }
    const k = keys[e.key.toLowerCase()]
    if (k) setTool(k)
    if (e.key === ' ') space.current = true
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') space.current = false
  }

  // ---------- presenting frames

  const present = (i: number) => {
    const f = frames[i]
    if (!f) return
    setPresenting(i)
    setSelected([])
    requestAnimationFrame(() => fit(slideOf(f.xywh), 24, MAX_Z))
  }
  useEffect(() => {
    if (presenting === null) return
    const f = frames[presenting]
    if (f) fit(slideOf(f.xywh), 24, MAX_Z)
    root.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting])

  // ---------- render

  const selRects = selected.map(rectOfId).filter((r): r is Rect => !!r)
  const selBox = union(selRects)
  const selectedSet = new Set(selected)
  const single = selected.length === 1 ? selected[0] : null
  const singleNote = single ? notes.find((n) => n.id === single) : undefined
  const singleEl = single ? byId.get(single) : undefined
  const grid = 24 * vp.z
  // A map with many pins shows only the major labels (capitals) until zoomed in.
  const crowded = elements.reduce((n, e) => n + (e.type === 'pin' ? 1 : 0), 0) > 40

  return (
    <div
      ref={root}
      className={`cv-root tool-${tool} ${presenting !== null ? 'presenting' : ''} ${crowded && vp.z < 1.6 ? 'labels-few' : ''}`}
      tabIndex={0}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${-vp.x * vp.z}px ${-vp.y * vp.z}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onDoubleClick={(e) => {
        if (tool !== 'select' || presenting !== null) return
        const hit = itemUnder(e.clientX, e.clientY)
        const el = hit ? byId.get(hit.id) : undefined
        if (el?.type === 'pin') return void openPage(el.page, e.ctrlKey || e.metaKey ? 'tab' : 'replace')
        if (el?.type === 'image') return
        if (hit && (hit.part === 'body' || hit.part === 'title')) {
          if (!isNote(hit.id)) setEditing(hit.id)
          return
        }
        if (!hit || hit.part === 'frame-body') {
          const [wx, wy] = toWorld(e.clientX, e.clientY)
          create('text', { x: wx, y: wy - 16, w: 200, h: 32 })
        }
      }}
      data-testid="canvas"
    >
      <div className="cv-world" style={{ transform: `scale(${vp.z}) translate(${-vp.x}px, ${-vp.y}px)` }}>
        {elements.map((el) =>
          el.type === 'image' ? (
            <img key={el.id} className={`cv-image ${selectedSet.has(el.id) ? 'selected' : ''}`} data-cid={el.id} src={el.src} alt="" draggable={false} style={box(rectOf(el.xywh))} />
          ) : null,
        )}
        {frames.map((f) => (
          <FrameView key={f.id} el={f} selected={selectedSet.has(f.id)} editing={editing === f.id} onText={(text) => (updateElements(doc, { [f.id]: { text } }), setEditing(null))} />
        ))}
        {elements.map((el) =>
          el.type === 'shape' || el.type === 'text' ? (
            <BoxView
              key={el.id}
              el={el}
              selected={selectedSet.has(el.id)}
              editing={editing === el.id}
              onText={(text, h) => {
                updateElements(doc, { [el.id]: el.type === 'text' && h ? { text, xywh: [el.xywh[0], el.xywh[1], el.xywh[2], h] } : { text } })
                setEditing(null)
              }}
            />
          ) : null,
        )}
        {elements.map((el) => (el.type === 'pin' ? <PinView key={el.id} el={el} selected={selectedSet.has(el.id)} /> : null))}
        {placedNotes.map((n) => (
          <NoteView
            key={n.id}
            note={n}
            selected={selectedSet.has(n.id)}
            host={host}
            spellcheck={spellcheck}
            onEditor={callbackFor(n.id)}
            onHeight={(h) => setHeights((hs) => (hs[n.id] === h ? hs : { ...hs, [n.id]: h }))}
          />
        ))}
        <svg className="cv-links" width="1" height="1">
          <defs>
            {['gray', ...Object.keys(COLOR_MARKERS)].map((c) => (
              <marker key={c} id={`cv-arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={colorOf(c)} />
              </marker>
            ))}
          </defs>
          {elements.map((el) => {
            if (el.type !== 'connector') return null
            const line = connectorLine(el)
            if (!line) return null
            const [[x1, y1], [x2, y2]] = line
            const color = el.stroke && COLOR_MARKERS[el.stroke] ? el.stroke : 'gray'
            return (
              <g key={el.id} data-cid={el.id} data-kind="connector" className={selectedSet.has(el.id) ? 'selected' : ''}>
                <line className="cv-link-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
                <line className="cv-link" x1={x1} y1={y1} x2={x2} y2={y2} stroke={colorOf(color)} markerEnd={`url(#cv-arrow-${color})`} />
              </g>
            )
          })}
        </svg>
        {elements.map((el) => {
          if (el.type !== 'connector') return null
          const line = connectorLine(el)
          if (!line || (!el.text && editing !== el.id)) return null
          const [mx, my] = [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2]
          return (
            <LinkLabel
              key={el.id}
              id={el.id}
              x={mx}
              y={my}
              text={el.text ?? ''}
              editing={editing === el.id}
              onText={(text) => (updateElements(doc, { [el.id]: { text } }), setEditing(null))}
            />
          )
        })}
      </div>

      {/* screen-space overlays */}
      {selBox && presenting === null && (
        <SelectionBox
          r={toScreen(selBox)}
          handles={single && singleEl?.type !== 'connector' ? (singleNote ? ['w', 'e'] : ['nw', 'ne', 'sw', 'se']) : []}
          id={single}
        />
      )}
      {preview?.kind === 'rect' && <div className={`cv-preview ${preview.tool === 'marquee' ? 'marquee' : ''}`} style={box(toScreen(preview.r))} />}
      {preview?.kind === 'line' && (
        <svg className="cv-preview-line">
          {preview.target && rectOfId(preview.target) && <rect className="cv-target" {...rectAttrs(toScreen(rectOfId(preview.target)!))} />}
          <line
            x1={(preview.from[0] - vp.x) * vp.z}
            y1={(preview.from[1] - vp.y) * vp.z}
            x2={(preview.to[0] - vp.x) * vp.z}
            y2={(preview.to[1] - vp.y) * vp.z}
          />
        </svg>
      )}
      {selBox && presenting === null && !preview && (
        <StyleBar
          at={toScreen(selBox)}
          items={selected.map((id) => byId.get(id)).filter((x): x is Element => !!x)}
          note={singleNote && selected.length === 1 ? singleNote : undefined}
          onStyle={(patch) => updateElements(doc, Object.fromEntries(selected.filter((id) => byId.has(id)).map((id) => [id, patchFor(byId.get(id)!, patch)])))}
          onDisplay={(display) => singleNote && setNoteLayout(doc, { [singleNote.id]: { display } })}
          onOpenPage={single && singleEl?.type === 'pin' ? () => openPage(singleEl.page, 'replace') : undefined}
          onDelete={() => {
            deleteItems(doc, new Set(selected))
            setSelected([])
          }}
        />
      )}
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void addImage(f)
        }}
      />
      {pinPicker && (
        <PinPicker
          at={pinPicker}
          host={host}
          onPick={(page, title) => {
            pinPage(pinPicker.wx, pinPicker.wy, page, title)
            setPinPicker(null)
            root.current?.focus()
          }}
          onClose={() => setPinPicker(null)}
        />
      )}
      {presenting === null ? (
        <>
          <Toolbar tool={tool} onTool={setTool} frames={frames.length} onPresent={() => present(0)} />
          <ZoomControls z={vp.z} onZoom={zoomBy} onFit={zoomToFit} />
        </>
      ) : (
        <div className="cv-present-bar">
          <span>
            {frames[presenting]?.text || 'Frame'} · {presenting + 1} / {frames.length}
          </span>
          <span className="muted-text">← → to move · Esc to exit</span>
        </div>
      )}
    </div>
  )

  function patchFor(el: Element, patch: Record<string, unknown>): Record<string, unknown> {
    // One color picker for everything: shapes use it as fill and stroke, the rest as their color.
    if (el.type === 'image') return {}
    if ('color' in patch) {
      const c = patch.color
      const { color: _, ...rest } = patch
      if (el.type === 'pin') return { ...rest, color: c }
      if (el.type === 'shape') return { ...rest, fill: c, stroke: c }
      if (el.type === 'text') return { ...rest, color: c }
      if (el.type === 'frame') return { ...rest, fill: c }
      return { ...rest, stroke: c }
    }
    if ('shape' in patch && el.type !== 'shape') return {}
    if ('fontSize' in patch && el.type !== 'text') return {}
    return patch
  }
}

/** A frame as a slide: with room for its title, which sits above it. */
const slideOf = ([x, y, w, h]: XYWH): Rect => ({ x, y: y - 28, w, h: h + 28 })

const COLOR_MARKERS: Record<string, true> = { brown: true, orange: true, yellow: true, green: true, blue: true, purple: true, pink: true, red: true }

const box = (r: Rect): React.CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h })
const rectAttrs = (r: Rect) => ({ x: r.x - 3, y: r.y - 3, width: r.w + 6, height: r.h + 6, rx: 6 })

/** Notes' xywh/display, re-read when any note's map changes (but not on every keystroke). */
function useNoteLayouts(doc: Y.Doc, refs: NoteRef[]): CanvasNote[] {
  const [, bump] = useState(0)
  useEffect(() => {
    const notes = doc.getMap('notes') as Y.Map<Y.Map<unknown>>
    const subs: (() => void)[] = []
    const watch = () => {
      subs.splice(0).forEach((u) => u())
      notes.forEach((m) => {
        const f = () => bump((n) => n + 1)
        m.observe(f)
        subs.push(() => m.unobserve(f))
      })
      bump((n) => n + 1)
    }
    watch()
    notes.observe(watch)
    return () => {
      notes.unobserve(watch)
      subs.forEach((u) => u())
    }
  }, [doc])
  return readNotes(refs, doc)
}

// ---------- items

/** A pin: a marker with the marked page's current title (or the label it was given). */
function PinView({ el, selected }: { el: Extract<Element, { type: 'pin' }>; selected: boolean }) {
  const page = useApp((s) => s.pages[el.page])
  const [x, y, w, h] = el.xywh
  const label = page?.title || el.text || 'Untitled'
  return (
    <div className={`cv-pin ${selected ? 'selected' : ''} ${page ? '' : 'gone'} ${el.color === 'yellow' ? 'major' : ''}`} data-cid={el.id} style={{ left: x, top: y, width: w, height: h }} title={`${label} (double-click to open)`}>
      <svg viewBox="0 0 24 24" width={w} height={h} aria-hidden>
        <path d="M12 2c-4 0-7 3-7 7 0 5.2 7 13 7 13s7-7.8 7-13c0-4-3-7-7-7z" fill={colorOf(el.color, '#c9a45c')} stroke="#1b140c" strokeWidth="1.2" />
        <circle cx="12" cy="9" r="2.6" fill="#1b140c" />
      </svg>
      <span className="cv-pin-label">
        {page?.icon ? `${page.icon} ` : ''}
        {label}
      </span>
    </div>
  )
}

/** Choose (or create) the page a new pin marks. */
function PinPicker({ at, host, onPick, onClose }: { at: { sx: number; sy: number }; host: EditorHost; onPick: (page: string, title: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [results, setResults] = useState<{ id: string; title: string; icon?: string }[]>([])
  useEffect(() => {
    let live = true
    void Promise.resolve(host.searchPages(q)).then((r) => live && setResults(r.slice(0, 8)))
    return () => {
      live = false
    }
  }, [q, host])
  const create = async () => {
    const title = q.trim()
    if (!title) return
    const id = await host.createPage(title, { subPageOf: true })
    onPick(id, title)
  }
  const choose = (n: number) => {
    const r = results[n]
    if (r) onPick(r.id, r.title || 'Untitled')
    else void create()
  }
  return (
    <div className="cv-pinpicker" style={{ left: at.sx, top: at.sy }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        placeholder="Which page does this pin mark?"
        value={q}
        onChange={(e) => (setQ(e.target.value), setI(0))}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          if (e.key === 'ArrowDown') setI((n) => Math.min(n + 1, results.length))
          if (e.key === 'ArrowUp') setI((n) => Math.max(n - 1, 0))
          if (e.key === 'Enter') choose(i)
        }}
        onBlur={() => setTimeout(onClose, 150)}
      />
      <ul>
        {results.map((r, n) => (
          <li key={r.id} className={n === i ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), choose(n))}>
            {r.icon ? `${r.icon} ` : ''}
            {r.title || 'Untitled'}
          </li>
        ))}
        {q.trim() && (
          <li className={i === results.length ? 'active new' : 'new'} onMouseDown={(e) => (e.preventDefault(), void create())}>
            + New page “{q.trim()}”
          </li>
        )}
      </ul>
    </div>
  )
}

/** Read a picture, shrinking big ones (a map scan can be huge) so the page stays light. */
export async function fitImage(file: File): Promise<{ src: string; w: number; h: number }> {
  if (!file.type.startsWith('image/')) throw new Error('that is not a picture')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('the picture could not be read'))
      i.src = url
    })
    const max = 4096
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    // PNG keeps transparency for small pictures; large ones become JPEG.
    let src = canvas.toDataURL('image/png')
    if (src.length > 3_000_000) src = canvas.toDataURL('image/jpeg', 0.85)
    if (src.length > 15_000_000) src = canvas.toDataURL('image/jpeg', 0.6)
    return { src, w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function NoteView({
  note,
  selected,
  host,
  spellcheck,
  onEditor,
  onHeight,
}: {
  note: CanvasNote
  selected: boolean
  host: EditorHost
  spellcheck: boolean
  onEditor: (e: TiptapEditor | null) => void
  onHeight: (h: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [x, y, w, h] = note.xywh!
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight))
    ro.observe(el)
    onHeight(el.offsetHeight)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      ref={ref}
      className={`cv-note ${selected ? 'selected' : ''} ${note.display === 'edgeless' ? 'canvas-only' : ''}`}
      data-cid={note.id}
      style={{ left: x, top: y, width: w, minHeight: h }}
    >
      <div className="cv-note-grip" data-cid={note.id} data-part="grip" title="Drag to move" />
      <div className="cv-note-body" data-cid={note.id} data-part="note-body">
        <NoteEditor fragment={note.ref.fragment} host={host} spellcheck={spellcheck} onEditor={onEditor} />
      </div>
    </div>
  )
}

function BoxView({ el, selected, editing, onText }: { el: Extract<Element, { type: 'shape' | 'text' }>; selected: boolean; editing: boolean; onText: (t: string, h?: number) => void }) {
  const [x, y, w, h] = el.xywh
  const textRef = useRef<HTMLDivElement>(null)
  const style: React.CSSProperties = { left: x, top: y, width: w, height: el.type === 'shape' ? h : undefined, minHeight: el.type === 'text' ? h : undefined }
  const color = el.type === 'text' ? colorOf(el.color, 'var(--foreground)') : 'var(--foreground)'
  const fontSize = el.type === 'text' ? el.fontSize ?? 20 : 14
  return (
    <div className={`cv-box kind-${el.type} ${selected ? 'selected' : ''}`} data-cid={el.id} style={style}>
      {el.type === 'shape' && (
        <svg className="cv-shape" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <ShapePath kind={el.shape} w={w} h={h} fill={fillOf(el.fill)} stroke={colorOf(el.stroke)} />
        </svg>
      )}
      {editing ? (
        <AutoTextarea
          initial={el.text ?? ''}
          style={{ fontSize, color }}
          className={el.type === 'shape' ? 'centered' : ''}
          onDone={(t, measured) => onText(t, measured)}
        />
      ) : (
        <div ref={textRef} className={`cv-text ${el.type === 'shape' ? 'centered' : ''}`} style={{ fontSize, color }}>
          {el.text || (el.type === 'text' ? <span className="cv-placeholder">Text</span> : null)}
        </div>
      )}
    </div>
  )
}

function ShapePath({ kind, w, h, fill, stroke }: { kind: ShapeKind; w: number; h: number; fill: string; stroke: string }) {
  const s = 1.5
  if (kind === 'ellipse') return <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - s)} ry={Math.max(0, h / 2 - s)} fill={fill} stroke={stroke} strokeWidth={2} />
  if (kind === 'diamond')
    return <polygon points={`${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`} fill={fill} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
  return <rect x={s} y={s} width={Math.max(0, w - 2 * s)} height={Math.max(0, h - 2 * s)} rx={8} fill={fill} stroke={stroke} strokeWidth={2} />
}

function FrameView({ el, selected, editing, onText }: { el: Extract<Element, { type: 'frame' }>; selected: boolean; editing: boolean; onText: (t: string) => void }) {
  const [x, y, w, h] = el.xywh
  return (
    <div className={`cv-frame ${selected ? 'selected' : ''}`} style={{ left: x, top: y, width: w, height: h, background: el.fill ? fillOf(el.fill) : undefined }} data-cid={el.id} data-part="frame-body">
      <div className="cv-frame-title" data-cid={el.id} data-part="title">
        {editing ? <AutoTextarea initial={el.text ?? ''} single onDone={(t) => onText(t.trim() || 'Frame')} /> : el.text || 'Frame'}
      </div>
    </div>
  )
}

function LinkLabel({ id, x, y, text, editing, onText }: { id: string; x: number; y: number; text: string; editing: boolean; onText: (t: string) => void }) {
  return (
    <div className="cv-link-label" data-cid={id} data-kind="connector" style={{ left: x, top: y }}>
      {editing ? <AutoTextarea initial={text} single onDone={(t) => onText(t.trim())} /> : text}
    </div>
  )
}

/** A textarea that commits on blur, Escape or (single line / Ctrl+Enter) Enter. */
function AutoTextarea({
  initial,
  single,
  style,
  className,
  onDone,
}: {
  initial: string
  single?: boolean
  style?: React.CSSProperties
  className?: string
  onDone: (text: string, height?: number) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const finish = () => {
    if (done.current || !ref.current) return
    done.current = true
    onDone(ref.current.value, Math.ceil(ref.current.scrollHeight))
  }
  const grow = () => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = t.scrollHeight + 'px'
  }
  useLayoutEffect(() => {
    const t = ref.current!
    t.focus()
    t.select()
    grow()
  }, [])
  return (
    <textarea
      ref={ref}
      className={`cv-edit ${className ?? ''} ${single ? 'single' : ''}`}
      defaultValue={initial}
      style={style}
      rows={1}
      onInput={grow}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (single || e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          finish()
          ;(e.currentTarget.closest('.cv-root') as HTMLElement | null)?.focus()
        }
      }}
    />
  )
}

function SelectionBox({ r, handles, id }: { r: Rect; handles: string[]; id: string | null }) {
  return (
    <div className="cv-selection" style={box({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 })}>
      {handles.map((h) => (
        <div key={h} className={`cv-handle h-${h}`} data-cid={id ?? ''} data-part="handle" data-handle={h} />
      ))}
    </div>
  )
}

