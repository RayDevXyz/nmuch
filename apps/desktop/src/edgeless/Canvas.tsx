import { NoteEditor, type EditorHost } from '@brainwaves/editor'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { NoteRef } from '../lib/core/page-sync'
import { openPage } from '../state/actions'
import { getState, setState, toast, useApp } from '../state/store'
import { campaignOf, liveFor, type Shown } from '../dnd/live'
import { DEFAULT_SCENE, placeToken, sceneBounds, ScenePanel, SceneOver, SceneUnder, snapToken, TokenPicker, useSceneSettings } from './scene'
import {
  addElement,
  addNote,
  CANVAS,
  canRotate,
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
  reorder,
  setNoteLayout,
  shown as isShown,
  textCss,
  undoManager,
  union,
  updateElements,
  useElements,
  type Boxed,
  type BookmarkEl,
  type CanvasNote,
  type ConnectorEl,
  type Element,
  type End,
  type NewElement,
  type Rect,
  type ShapeKind,
  type XYWH,
} from './model'
import { ZoomBar, type Tool } from './chrome'
import { mergeNotes, splitAtCursor, splitByHeadings } from './split'
import { ContextBar } from './ContextBar'
import { alignBoxes, angleTo, distributeBoxes, resizeTurned, snapBox, snapEdges, turnedBounds, type Guide } from './geometry'
import { DRAG_TYPE, presetById, rememberUpload, SidePanel, type PanelTab, type Preset } from './SidePanel'
import { DRAG as BURROW_DRAG, domainOf, droppedBookmark, getBookmark } from '../burrow/api'
import { openExternal } from '../lib/storage'

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
/** The side panel's tab, kept across pages (null: closed). Battle maps keep their own: closed at
 * first, since the table panel takes the other side. */
let lastTab: PanelTab | null = 'elements'
let lastSceneTab: PanelTab | null = null
const RAIL_W = 64
const DRAWER_W = 268
const SNAP_PX = 6

/** Show a page's whole canvas: now if it's open, else the next time it opens. */
export function fitCanvas(pageId: string) {
  viewports.delete(pageId)
  window.dispatchEvent(new CustomEvent('bw-canvas-fit', { detail: pageId }))
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vp: Viewport }
  | { kind: 'move'; wx: number; wy: number; orig: Map<string, XYWH>; moved: boolean; base: Rect | null; others: Rect[] }
  | { kind: 'resize'; id: string; handle: string; wx: number; wy: number; orig: XYWH; note: boolean; deg: number; ratio: boolean; others: Rect[] }
  | { kind: 'rotate'; id: string; cx: number; cy: number }
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
  /** A D&D battle map: grid, fog, tokens and the live table. */
  scene?: boolean
}

export function Canvas({ pageId, doc, notes: noteRefs, host, spellcheck, onEditor, scene = false }: CanvasProps) {
  const root = useRef<HTMLDivElement>(null)
  const elements = useElements(doc)
  const allNotes = useNoteLayouts(doc, noteRefs)
  // Notes on their way out: unmounted first (closing their editors), deleted on the next frame.
  // Deleting a note whose editor is still bound to it breaks the editor.
  const [retiring, setRetiring] = useState<Set<string>>(new Set())
  const notes = useMemo(() => (retiring.size ? allNotes.filter((n) => !retiring.has(n.id)) : allNotes), [allNotes, retiring])
  useEffect(() => {
    if (!retiring.size) return
    const t = requestAnimationFrame(() => {
      deleteItems(doc, retiring)
      setRetiring(new Set())
    })
    return () => cancelAnimationFrame(t)
  }, [retiring, doc])
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
  const [guides, setGuides] = useState<Guide[]>([])
  const [readout, setReadout] = useState<{ text: string; x: number; y: number } | null>(null)
  const [tab, setTabState] = useState<PanelTab | null>(scene ? lastSceneTab : lastTab)
  const setTab = (t: PanelTab | null) => (scene ? (lastSceneTab = t) : (lastTab = t), setTabState(t))
  const leftInset = RAIL_W + (tab ? DRAWER_W : 0)
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

  // ---------- battle maps
  const [sceneSettings, setSceneSettings] = useSceneSettings(pageId, scene)
  const settingsRef = useRef(sceneSettings)
  settingsRef.current = sceneSettings
  // A battle map goes live on its campaign's table (one room, one link per campaign).
  const campaign = useApp((s) => (scene ? campaignOf(pageId) : null))
  const live = useMemo(() => (scene && campaign ? liveFor(campaign) : null), [scene, campaign])
  const shown = useCallback(
    (): Shown => ({ sceneId: pageId, doc, getSettings: () => settingsRef.current ?? DEFAULT_SCENE, getTitle: () => getState().pages[pageId]?.title || 'Battle map' }),
    [pageId, doc],
  )
  useEffect(() => live?.rebind(shown()), [live, shown])
  useEffect(() => {
    if (live?.state.showing === pageId) live.schedule()
  }, [live, sceneSettings, pageId])
  const [tokenPicker, setTokenPicker] = useState<{ wx: number; wy: number; sx: number; sy: number } | null>(null)
  const gridOf = () => (settingsRef.current ?? DEFAULT_SCENE).grid

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
      if (el && el.type !== 'connector') return turnedBounds(el.xywh, el.rotate)
      const n = notes.find((x) => x.id === id)
      return n?.xywh ? noteRect(n) : null
    },
    [byId, notes, noteRect],
  )
  /** A selection grows to whole groups. */
  const withGroups = (ids: string[]): string[] => {
    const groupOf = (id: string) => byId.get(id)?.group ?? notes.find((n) => n.id === id)?.group
    const groups = new Set(ids.map(groupOf).filter(Boolean))
    if (!groups.size) return ids
    return [
      ...new Set([
        ...ids,
        ...elements.filter((e) => e.group && groups.has(e.group)).map((e) => e.id),
        ...notes.filter((n) => n.group && groups.has(n.group)).map((n) => n.id),
      ]),
    ]
  }
  /** What smart guides line up with: everything drawn that isn't moving. */
  const snapTargets = (moving: Set<string>): Rect[] => {
    const out: Rect[] = []
    for (const e of elements) if (e.type !== 'connector' && e.type !== 'reveal' && isShown(e) && !moving.has(e.id)) out.push(turnedBounds(e.xywh, e.rotate))
    for (const n of placedNotes) if (!moving.has(n.id)) out.push(noteRect(n))
    return out.length > 3000 ? [] : out
  }
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

  /** Show `r` whole, beside the side panel; `right` is room kept free on the right (the battle map's panel). */
  const fit = (r: Rect | null, pad = 60, maxZ = 1, right = 0) => {
    const b = root.current?.getBoundingClientRect()
    if (!r || !b) return
    const left = presenting !== null ? 0 : leftInset
    const top = presenting !== null ? 0 : 56
    const width = b.width - right - left
    const height = b.height - top
    const z = Math.max(MIN_Z, Math.min(maxZ, (width - pad * 2) / (r.w || 1), (height - pad * 2) / (r.h || 1)))
    setVp({ z, x: r.x + r.w / 2 - (left + width / 2) / z, y: r.y + r.h / 2 - (top + height / 2) / z })
  }
  /** The middle of what's visible, in world space (beside the panel). */
  const viewCenter = (): [number, number] => {
    const b = root.current!.getBoundingClientRect()
    return [(leftInset + (b.width - leftInset) / 2) / vp.z + vp.x, b.height / 2 / vp.z + vp.y]
  }
  const allBounds = () =>
    union([...placedNotes.map(noteRect), ...elements.flatMap((e) => (e.type === 'connector' || !isShown(e) ? [] : [turnedBounds(e.xywh, e.rotate)]))])
  function zoomToFit() {
    // A battle map fits its picture, beside the table panel.
    if (scene && elements.some((e) => e.type === 'image')) return fit(sceneBounds(elements), 40, 2, 320)
    fit(allBounds())
  }
  const zoomTo = (z: number) => {
    const b = root.current!.getBoundingClientRect()
    zoomBy(z / vp.z, [leftInset + (b.width - leftInset) / 2, b.height / 2])
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
    } else if (t === 'token') {
      const b = root.current!.getBoundingClientRect()
      setTokenPicker({ wx: r.x, wy: r.y, sx: (r.x - vp.x) * vp.z + b.left, sy: (r.y - vp.y) * vp.z + b.top })
      setTool('select')
      return
    } else if (t === 'reveal') {
      if (r.w < 8 || r.h < 8) return
      id = addElement(doc, { type: 'reveal', xywh: [r.x, r.y, r.w, r.h] })
      setSelected([id])
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
  const addImage = async (file: File, drop?: { x: number; y: number }) => {
    const at = drop ?? pendingImage.current ?? (() => {
      const [cx, cy] = viewCenter()
      return { x: cx - 200, y: cy - 150 }
    })()
    pendingImage.current = null
    try {
      const { src, w, h } = await fitImage(file)
      rememberUpload({ src, w, h })
      // A battle map keeps its own size (its squares match the grid) and sits on the grid.
      const width = scene ? w : Math.min(w, 1600)
      const g = gridOf()
      const [x, y] = scene ? [Math.round((at.x - g.offsetX) / g.size) * g.size + g.offsetX, Math.round((at.y - g.offsetY) / g.size) * g.size + g.offsetY] : [Math.round(at.x), Math.round(at.y)]
      const id = addElement(doc, { type: 'image', xywh: [x, y, width, Math.round((h / w) * width)], src, index: keyBefore() })
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
    // Alt-click on a live battle map: ping it for everyone.
    if (scene && e.altKey && !middle && live?.state.status === 'live' && live.state.showing === pageId) {
      live.ping(Math.round(wx), Math.round(wy))
      return
    }

    // Inside a note's text or a text box being edited: leave it to the editor.
    if (hit && hit.part === 'note-body' && tool === 'select' && !middle && !space.current) {
      if (!selected.includes(hit.id)) setSelected([hit.id])
      return
    }
    if ((e.target as HTMLElement).closest('textarea, input, select, .cv-context, .cv-side, .cv-zoom')) return

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
      const handle = ((e.target as HTMLElement).closest('[data-handle]') as HTMLElement | null)?.dataset.handle ?? 'se'
      const n = notes.find((x) => x.id === id)
      const el = byId.get(id) as Boxed | undefined
      um?.stopCapturing()
      if (handle === 'rot' && el) {
        const [x, y, w, h] = el.xywh
        gesture.current = { kind: 'rotate', id, cx: x + w / 2, cy: y + h / 2 }
        return
      }
      const orig = n?.xywh ?? el?.xywh
      const ratio = el?.type === 'image' || el?.type === 'pin' || el?.type === 'token'
      if (orig) gesture.current = { kind: 'resize', id, handle, wx, wy, orig: [...orig] as XYWH, note: !!n, deg: el?.rotate ?? 0, ratio, others: snapTargets(new Set([id])) }
      return
    }
    if (hit && hit.part !== 'frame-body') {
      // A click takes the whole group; Ctrl/⌘-click picks one item inside it.
      const deep = e.ctrlKey || e.metaKey
      const take = deep ? [hit.id] : withGroups([hit.id])
      const sel = e.shiftKey
        ? take.every((id) => selected.includes(id))
          ? selected.filter((s) => !take.includes(s))
          : [...new Set([...selected, ...take])]
        : selected.includes(hit.id) && !deep
          ? selected
          : take
      setSelected(sel)
      um?.stopCapturing()
      const orig = movable(sel)
      gesture.current = { kind: 'move', wx, wy, orig, moved: false, base: union([...orig.keys()].map(rectOfId).filter((r): r is Rect => !!r)), others: [] }
      if (orig.size) gesture.current.others = snapTargets(new Set(orig.keys()))
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
      if (el?.locked) return
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
        // Smart guides: line the selection up with what's around (Ctrl: move freely; tokens use the grid).
        let sdx = dx
        let sdy = dy
        const tokensOnly = scene && [...g.orig.keys()].every((id) => byId.get(id)?.type === 'token')
        if (g.base && !e.ctrlKey && !e.metaKey && !tokensOnly) {
          const snap = snapBox({ ...g.base, x: g.base.x + dx, y: g.base.y + dy }, g.others, SNAP_PX / vp.z)
          sdx += snap.dx
          sdy += snap.dy
          setGuides(snap.guides)
        } else setGuides([])
        const els: Record<string, Record<string, unknown>> = {}
        const ns: Record<string, { xywh: XYWH }> = {}
        g.orig.forEach(([x, y, w, h], id) => {
          const xywh: XYWH = [Math.round(x + sdx), Math.round(y + sdy), w, h]
          if (isNote(id)) ns[id] = { xywh }
          else els[id] = { xywh }
        })
        doc.transact(() => {
          updateElements(doc, els)
          setNoteLayout(doc, ns)
        }, CANVAS)
        return
      }
      case 'rotate': {
        const deg = angleTo(g.cx, g.cy, wx, wy, !e.shiftKey)
        updateElements(doc, { [g.id]: { rotate: deg || undefined } })
        const b = root.current!.getBoundingClientRect()
        setReadout({ text: `${deg}°`, x: e.clientX - b.left + 16, y: e.clientY - b.top + 16 })
        return
      }
      case 'resize': {
        const [x, y, w, h] = g.orig
        const dx = wx - g.wx
        const dy = wy - g.wy
        if (!g.note) {
          // In the item's own frame (it may be turned); pictures keep their proportions (Shift: don't).
          let xywh = resizeTurned(g.orig, g.deg, g.handle, dx, dy, 8, g.ratio !== e.shiftKey)
          if (!g.deg && !(g.ratio !== e.shiftKey) && !e.ctrlKey && !e.metaKey) {
            const snap = snapEdges(xywh, g.handle, g.others, SNAP_PX / vp.z)
            xywh = snap.box
            setGuides(snap.guides)
          } else setGuides([])
          updateElements(doc, { [g.id]: { xywh } })
          const b = root.current!.getBoundingClientRect()
          setReadout({ text: `${xywh[2]} × ${xywh[3]}`, x: e.clientX - b.left + 16, y: e.clientY - b.top + 16 })
          return
        }
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
        // Locked and hidden items stay out of a marquee; groups come whole.
        const pickable = (el: Element) => !el.locked && isShown(el)
        const inside = [
          ...elements
            .filter((el) => pickable(el) && el.type !== 'connector' && el.type !== 'frame' && (scene && el.type === 'image' ? contains(r, rectOf(el.xywh)) : intersects(r, turnedBounds(el.xywh, el.rotate))))
            .map((el) => el.id),
          ...frames.filter((f) => pickable(f) && contains(r, rectOf(f.xywh))).map((f) => f.id),
          ...placedNotes.filter((n) => intersects(r, noteRect(n))).map((n) => n.id),
        ]
        setSelected([...new Set([...g.additive, ...withGroups(inside)])])
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
    setGuides([])
    setReadout(null)
    if (!g) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    if (g.kind === 'create') {
      const r = normRect(g.wx, g.wy, wx, wy)
      const clicked = r.w * vp.z < 6 && r.h * vp.z < 6
      const defaults: Partial<Record<Tool, [number, number]>> = { note: [NOTE_W / 2, 80], text: [200, 32], frame: [640, 400], rect: [160, 100], ellipse: [160, 100], diamond: [160, 120] }
      const [dw, dh] = defaults[g.tool] ?? [160, 100]
      create(g.tool, clicked ? { x: g.wx, y: g.wy, w: g.tool === 'reveal' ? 0 : dw, h: g.tool === 'reveal' ? 0 : dh } : r)
    } else if (g.kind === 'connect') {
      const target = itemAtPoint(e.clientX, e.clientY)
      const end: End = target && !('id' in g.source && g.source.id === target) ? { id: target } : { point: [wx, wy] }
      if (Math.hypot(wx - g.wx, wy - g.wy) * vp.z < 8 && !('id' in end)) return
      const id = addElement(doc, { type: 'connector', source: g.source, target: end, stroke: 'gray', text: '' })
      setSelected([id])
      setTool('select')
    } else if (g.kind === 'move' && g.moved && scene) {
      // Tokens land on the grid.
      const snapped: Record<string, Record<string, unknown>> = {}
      g.orig.forEach((_, id) => {
        const el = byId.get(id)
        if (el?.type !== 'token') return
        const cur = (doc.getMap('surface').get(id) as Y.Map<unknown> | undefined)?.get('xywh') as XYWH | undefined
        if (!cur) return
        const [x, y] = snapToken(cur[0], cur[1], cur[2], cur[3], gridOf())
        snapped[id] = { xywh: [x, y, cur[2], cur[3]] }
      })
      if (Object.keys(snapped).length) doc.transact(() => updateElements(doc, snapped), CANVAS)
    } else if (g.kind === 'move' && !g.moved) {
      // A plain click on an already selected item narrows the selection to it (or its group).
      const hit = itemUnder(e.clientX, e.clientY)
      if (hit && !e.shiftKey) setSelected(e.ctrlKey || e.metaKey ? [hit.id] : withGroups([hit.id]))
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
      return setSelected([...elements.filter((el) => isShown(el) && !el.locked).map((el) => el.id), ...placedNotes.map((n) => n.id)])
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      return duplicate()
    }
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      return e.shiftKey ? ungroup() : group()
    }
    if (mod && (e.key === ']' || e.key === '[' || e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault()
      const up = e.key === ']' || e.code === 'BracketRight'
      return reorder(doc, selected, e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward')
    }
    if (e.altKey && e.shiftKey && e.code === 'KeyL') {
      e.preventDefault()
      return lock(!selectedEls().every((x) => x.locked))
    }
    if (mod && (e.key === '0' || e.key === '1')) return void (e.preventDefault(), zoomToFit())
    if (mod && (e.key === '=' || e.key === '+')) return void (e.preventDefault(), zoomBy(1.25))
    if (mod && e.key === '-') return void (e.preventDefault(), zoomBy(0.8))
    if (mod) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
      e.preventDefault()
      return remove()
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
    const keys: Record<string, Tool> = { v: 'select', h: 'hand', n: 'note', r: 'rect', o: 'ellipse', d: 'diamond', t: 'text', c: 'connector', f: 'frame', i: 'image', p: 'pin', ...(scene ? ({ k: 'token', e: 'reveal' } as const) : {}) }
    const k = keys[e.key.toLowerCase()]
    if (k) setTool(k)
    if (e.key === ' ') space.current = true
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') space.current = false
  }

  // ---------- actions on the selection (keyboard, context bar)

  const selectedEls = () => selected.map((id) => byId.get(id)).filter((x): x is Element => !!x)
  function duplicate() {
    // Copies keep their groups among themselves, as new groups.
    const regroup = new Map<string, string>()
    const copies = selectedEls().flatMap((el) => {
      if (el.type === 'connector') return []
      const { id: _, index: __, locked: ___, ...rest } = el
      const [x, y, w, h] = el.xywh
      const g = el.group ? (regroup.get(el.group) ?? regroup.set(el.group, `g${Math.random().toString(36).slice(2, 10)}`).get(el.group)) : undefined
      return [addElement(doc, { ...rest, group: g, xywh: [x + 24, y + 24, w, h] } as NewElement)]
    })
    if (copies.length) setSelected(copies)
  }
  function remove() {
    const locked = selectedEls().filter((x) => x.locked)
    if (locked.length) toast(`${locked.length === 1 ? 'A locked item stays' : 'Locked items stay'}: unlock to delete`)
    const ids = selected.filter((id) => !byId.get(id)?.locked)
    if (ids.filter(isNote).length >= notes.length) toast('A page keeps at least one note')
    const noteIds = ids.filter(isNote)
    deleteItems(doc, new Set(ids.filter((id) => !isNote(id))))
    if (noteIds.length) setRetiring(new Set(noteIds.slice(0, Math.max(0, notes.length - 1))))
    setSelected(selected.filter((id) => byId.get(id)?.locked))
  }
  const selectedNotes = () => notes.filter((n) => selected.includes(n.id))
  function group() {
    const els = selectedEls().filter((x) => x.type !== 'connector')
    const ns = selectedNotes()
    if (els.length + ns.length < 2) return toast('Select two or more things to group')
    const g = `g${Math.random().toString(36).slice(2, 10)}`
    doc.transact(() => {
      updateElements(doc, Object.fromEntries(els.map((x) => [x.id, { group: g }])))
      setNoteLayout(doc, Object.fromEntries(ns.map((n) => [n.id, { group: g }])))
    }, CANVAS)
    toast('Grouped: Ctrl+click picks one item inside')
  }
  function ungroup() {
    doc.transact(() => {
      updateElements(doc, Object.fromEntries(selectedEls().filter((x) => x.group).map((x) => [x.id, { group: undefined }])))
      setNoteLayout(doc, Object.fromEntries(selectedNotes().filter((n) => n.group).map((n) => [n.id, { group: null }])))
    }, CANVAS)
  }
  // ---------- splitting a page into parts, and merging them back
  function splitNote(how: 'cursor' | 'headings') {
    const n = selectedNotes()[0]
    const ed = n && editors.current.get(n.id)
    if (!n || !ed) return
    const r = how === 'cursor' ? splitAtCursor(doc, n, ed) : splitByHeadings(doc, n, ed)
    if (typeof r === 'object' && 'error' in r) return toast(r.error)
    const made = Array.isArray(r) ? r : [r]
    setSelected([n.id, ...made])
    toast(made.length === 1 ? 'Split in two: drag the parts apart' : `Split into ${made.length + 1} parts`)
  }
  function mergeSelectedNotes() {
    const r = mergeNotes(doc, selectedNotes(), editors.current)
    if ('error' in r) return toast(r.error)
    setRetiring(new Set(r.remove))
    setSelected([r.keep])
    toast('Merged into one note')
  }
  function lock(on: boolean) {
    updateElements(doc, Object.fromEntries(selectedEls().map((x) => [x.id, { locked: on || undefined }])))
  }
  function moveBy(shifts: Record<string, [number, number]>) {
    const patches: Record<string, Record<string, unknown>> = {}
    const ns: Record<string, { xywh: XYWH }> = {}
    for (const [id, [dx, dy]] of Object.entries(shifts)) {
      const el = byId.get(id)
      if (el && el.type !== 'connector' && !el.locked) patches[id] = { xywh: [el.xywh[0] + dx, el.xywh[1] + dy, el.xywh[2], el.xywh[3]] }
      const n = notes.find((x) => x.id === id)
      if (n?.xywh) ns[id] = { xywh: [n.xywh[0] + dx, n.xywh[1] + dy, n.xywh[2], n.xywh[3]] }
    }
    doc.transact(() => (updateElements(doc, patches), setNoteLayout(doc, ns)), CANVAS)
  }
  const boxesOfSelection = () => selected.map((id) => ({ id, r: rectOfId(id) })).filter((b): b is { id: string; r: Rect } => !!b.r)

  /** Add a preset from the side panel: at a drop point, or in the middle of the view. */
  function addPreset(preset: Preset, at?: [number, number]) {
    const [cx, cy] = at ?? viewCenter()
    const made = preset.make()
    setTool('select')
    if ('note' in made) {
      const id = addNote(doc, [Math.round(cx - made.w / 2), Math.round(cy - 40), made.w, 80], 'both')
      focusNote.current = id
      return setSelected([id])
    }
    const el = made as Extract<NewElement, { xywh: XYWH }>
    const [, , w, h] = el.xywh
    const id = addElement(doc, { ...el, xywh: [Math.round(cx - w / 2), Math.round(cy - h / 2), w, h] } as NewElement)
    setSelected([id])
    if (el.type === 'frame') requestAnimationFrame(() => fit({ x: cx - w / 2 - 40, y: cy - h / 2 - 60, w: w + 80, h: h + 100 }, 40, vp.z))
  }
  /** Zoom to an item and select it (from Layers or Uploads). */
  function focusItem(id: string) {
    const r = rectOfId(id)
    if (!r) return
    setSelected([id])
    fit({ x: r.x - 80, y: r.y - 80, w: r.w + 160, h: r.h + 160 }, 40, 1.5)
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
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes(BURROW_DRAG) || e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const [wx, wy] = toWorld(e.clientX, e.clientY)
        const preset = presetById(e.dataTransfer.getData(DRAG_TYPE))
        if (preset) {
          e.preventDefault()
          return addPreset(preset, [wx, wy])
        }
        // A bookmark from the Burrow panel becomes a link card.
        const bm = droppedBookmark(e.dataTransfer)
        if (bm?.url) {
          e.preventDefault()
          const id = addElement(doc, { type: 'bookmark', xywh: [Math.round(wx - 170), Math.round(wy - 60), 340, 120], url: bm.url, text: bm.title || bm.url, burrowId: bm.id })
          setSelected([id])
          void getBookmark(bm.id).then((b) => updateElements(doc, { [id]: { image: b.image_url || undefined, site: b.site_name || domainOf(b.url) || undefined, text: b.title || bm.title || bm.url } }), () => {})
          return
        }
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
        if (files.length) {
          e.preventDefault()
          files.forEach((f, i) => void addImage(f, { x: wx + i * 40, y: wy + i * 40 }))
        }
      }}
      onDoubleClick={(e) => {
        if (tool !== 'select' || presenting !== null) return
        const hit = itemUnder(e.clientX, e.clientY)
        const el = hit ? byId.get(hit.id) : undefined
        if (el?.type === 'pin') return void openPage(el.page, e.ctrlKey || e.metaKey ? 'tab' : 'replace')
        if (el?.type === 'token') return void (el.page && openPage(el.page, 'tab'))
        if (el?.type === 'reveal') return
        if (el?.type === 'bookmark') return void openExternal(el.url)
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
        {/* A battle map's picture stays under the grid and the fog. */}
        {scene &&
          elements.map((el) =>
            el.type === 'image' && isShown(el) ? (
              <img key={el.id} className={`cv-image ${selectedSet.has(el.id) ? 'selected' : ''} locked`} data-cid={el.id} src={el.src} alt="" draggable={false} style={{ ...box(rectOf(el.xywh)), ...layerStyle(el) }} />
            ) : null,
          )}
        {scene && sceneSettings && <SceneUnder elements={elements} settings={sceneSettings} selected={selectedSet} />}
        {frames.filter(isShown).map((f) => (
          <FrameView key={f.id} el={f} selected={selectedSet.has(f.id)} editing={editing === f.id} onText={(text) => (updateElements(doc, { [f.id]: { text } }), setEditing(null))} />
        ))}
        <svg className="cv-links" width="1" height="1">
          <defs>
            {['gray', ...Object.keys(COLOR_MARKERS)].map((c) => (
              <marker key={c} id={`cv-arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={colorOf(c)} />
              </marker>
            ))}
          </defs>
        </svg>
        {/* Everything else in its stacking order (Layers, Position). */}
        {elements.map((el) => {
          if (!isShown(el)) return null
          const sel = selectedSet.has(el.id)
          if (el.type === 'image')
            return scene ? null : (
              <img key={el.id} className={`cv-image ${sel ? 'selected' : ''} ${el.locked ? 'is-locked' : ''}`} data-cid={el.id} src={el.src} alt="" draggable={false} style={{ ...box(rectOf(el.xywh)), ...layerStyle(el) }} />
            )
          if (el.type === 'shape' || el.type === 'text')
            return (
              <BoxView
                key={el.id}
                el={el}
                selected={sel}
                editing={editing === el.id}
                onText={(text, h) => {
                  updateElements(doc, { [el.id]: el.type === 'text' && h ? { text, xywh: [el.xywh[0], el.xywh[1], el.xywh[2], h] } : { text } })
                  setEditing(null)
                }}
              />
            )
          if (el.type === 'pin') return <PinView key={el.id} el={el} selected={sel} />
          if (el.type === 'bookmark') return <BookmarkView key={el.id} el={el} selected={sel} />
          if (el.type === 'connector') {
            const line = connectorLine(el)
            if (!line) return null
            const [[x1, y1], [x2, y2]] = line
            const named = el.stroke && COLOR_MARKERS[el.stroke] ? el.stroke : null
            const stroke = named ? colorOf(named) : colorOf(el.stroke, colorOf('gray'))
            return (
              <svg key={el.id} className="cv-links" width="1" height="1" style={layerStyle(el)}>
                <g data-cid={el.id} data-kind="connector" className={sel ? 'selected' : ''}>
                  <line className="cv-link-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
                  <line className="cv-link" x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} markerEnd={`url(#cv-arrow-${named ?? 'gray'})`} />
                </g>
              </svg>
            )
          }
          return null
        })}
        {scene && <SceneOver elements={elements} live={live} selected={selectedSet} pageId={pageId} />}
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
        <>
          {/* Each item of a multiple selection gets its own outline. */}
          {selected.length > 1 &&
            selected.map((id) => {
              const r = rectOfId(id)
              return r ? <div key={id} className="cv-sel-item" style={box(toScreen(r))} /> : null
            })}
          {singleEl && singleEl.type !== 'connector' && singleEl.rotate ? (
            <TurnedSelection r={toScreen(rectOf(singleEl.xywh))} deg={singleEl.rotate} handles={handlesFor(singleEl)} id={single} rotatable={!singleEl.locked && canRotate(singleEl)} />
          ) : (
            <SelectionBox
              r={toScreen(selBox)}
              handles={single ? (singleNote ? ['w', 'e'] : singleEl && singleEl.type !== 'connector' ? handlesFor(singleEl) : []) : []}
              id={single}
              rotatable={!!singleEl && !singleEl.locked && canRotate(singleEl)}
              locked={selectedEls().some((x) => x.locked)}
            />
          )}
        </>
      )}
      {guides.length > 0 && (
        <svg className="cv-guides">
          {guides.map((g, i) =>
            g.axis === 'x' ? (
              <line key={i} x1={(g.at - vp.x) * vp.z} x2={(g.at - vp.x) * vp.z} y1={(g.from - vp.y) * vp.z - 8} y2={(g.to - vp.y) * vp.z + 8} />
            ) : (
              <line key={i} y1={(g.at - vp.y) * vp.z} y2={(g.at - vp.y) * vp.z} x1={(g.from - vp.x) * vp.z - 8} x2={(g.to - vp.x) * vp.z + 8} />
            ),
          )}
        </svg>
      )}
      {readout && (
        <div className="cv-readout" style={{ left: readout.x, top: readout.y }}>
          {readout.text}
        </div>
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
      {selBox && presenting === null && (
        <ContextBar
          left={leftInset}
          items={selectedEls()}
          note={singleNote && selected.length === 1 ? singleNote : undefined}
          notes={selectedNotes()}
          onSplit={splitNote}
          onMerge={mergeSelectedNotes}
          onPatch={(patch) =>
            updateElements(
              doc,
              Object.fromEntries(
                selectedEls()
                  .filter((x) => !x.locked)
                  .map((x) => [x.id, patchFor(x, patch)])
                  .filter(([, p]) => Object.keys(p as object).length),
              ),
            )
          }
          onOrder={(o) => reorder(doc, selected, o)}
          onAlign={(a) => moveBy(alignBoxes(boxesOfSelection(), a))}
          onDistribute={(axis) => moveBy(distributeBoxes(boxesOfSelection(), axis))}
          onGroup={group}
          onUngroup={ungroup}
          onLock={lock}
          onDuplicate={duplicate}
          onDelete={remove}
          onDisplay={(display) => singleNote && setNoteLayout(doc, { [singleNote.id]: { display } })}
          onOpenPage={single && singleEl?.type === 'pin' ? () => openPage(singleEl.page, 'replace') : undefined}
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
      {tokenPicker && sceneSettings && (
        <TokenPicker
          at={tokenPicker}
          onPick={(p) => {
            const id = placeToken(doc, p, tokenPicker.wx, tokenPicker.wy, sceneSettings.grid)
            setTokenPicker(null)
            setSelected([id])
            root.current?.focus()
          }}
          onClose={() => setTokenPicker(null)}
        />
      )}
      {scene && sceneSettings && live && presenting === null && (
        <ScenePanel pageId={pageId} onShow={() => live.show(shown())} doc={doc} elements={elements} settings={sceneSettings} onSettings={setSceneSettings} selected={selected} onSelect={setSelected} live={live} />
      )}
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
          <SidePanel
            tab={tab}
            onTab={setTab}
            tool={tool}
            onTool={setTool}
            scene={scene}
            onAdd={(p) => addPreset(p)}
            onUpload={() => ((pendingImage.current = null), imageInput.current?.click())}
            onAddImage={(img) => {
              const [cx, cy] = viewCenter()
              const width = Math.min(img.w, 1600)
              const height = Math.round((img.h / img.w) * width)
              const id = addElement(doc, { type: 'image', xywh: [Math.round(cx - width / 2), Math.round(cy - height / 2), width, height], src: img.src })
              setSelected([id])
            }}
            doc={doc}
            elements={elements}
            notes={notes}
            selected={selected}
            onSelect={(ids) => setSelected(ids)}
            onFocus={focusItem}
          />
          <ZoomBar z={vp.z} onZoomTo={zoomTo} onZoom={zoomBy} onFit={zoomToFit} onUndo={() => um?.undo()} onRedo={() => um?.redo()} frames={frames.length} onPresent={() => present(0)} />
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

  /** The part of a patch that applies to this element (a text style means nothing to a picture). */
  function patchFor(el: Element, patch: Record<string, unknown>): Record<string, unknown> {
    const t = el.type
    const ok: Record<string, boolean> = {
      fill: t === 'shape' || t === 'frame',
      stroke: t === 'shape' || t === 'connector',
      strokeWidth: t === 'shape',
      color: t === 'text' || t === 'shape' || t === 'pin' || t === 'token',
      shape: t === 'shape',
      rotate: canRotate(el),
      opacity: t !== 'reveal',
    }
    for (const k of ['fontSize', 'fontFamily', 'bold', 'italic', 'underline', 'align']) ok[k] = t === 'text' || t === 'shape'
    return Object.fromEntries(Object.entries(patch).filter(([k]) => ok[k] ?? true))
  }
}

/** Which resize handles an element gets. */
function handlesFor(el: Element): string[] {
  if (el.locked || el.type === 'connector') return []
  if (el.type === 'pin' || el.type === 'token') return ['nw', 'ne', 'sw', 'se']
  if (el.type === 'text') return ['nw', 'ne', 'sw', 'se', 'w', 'e']
  return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
}

/** Transparency and turning, as CSS. */
function layerStyle(el: Element): React.CSSProperties {
  return {
    opacity: el.opacity ?? undefined,
    transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
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
    <div className={`cv-pin ${selected ? 'selected' : ''} ${page ? '' : 'gone'} ${el.color === 'yellow' ? 'major' : ''}`} data-cid={el.id} style={{ left: x, top: y, width: w, height: h, opacity: el.opacity }} title={`${label} (double-click to open)`}>
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

/** A link card on the canvas (a bookmark from Burrow). Double-click opens the link. */
function BookmarkView({ el, selected }: { el: BookmarkEl; selected: boolean }) {
  const [x, y, w, h] = el.xywh
  return (
    <div className={`cv-bookmark ${selected ? 'selected' : ''} ${el.image ? 'with-image' : ''}`} data-cid={el.id} style={{ left: x, top: y, width: w, height: h, ...layerStyle(el) }} title={`${el.url} (double-click to open)`}>
      <div className="cv-bookmark-text">
        <small>{el.site || domainOf(el.url)}</small>
        <b>{el.text || el.url}</b>
        <span>{el.url}</span>
      </div>
      {el.image && <img src={el.image} alt="" draggable={false} onError={(e) => (e.currentTarget.style.display = 'none')} />}
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
  const style: React.CSSProperties = { left: x, top: y, width: w, height: el.type === 'shape' ? h : undefined, minHeight: el.type === 'text' ? h : undefined, ...layerStyle(el) }
  const color = colorOf(el.color, 'var(--foreground)')
  const text = { ...textCss(el, el.type === 'text' ? 20 : 14), color }
  const fontSize = text.fontSize
  const sw = el.type === 'shape' ? (el.strokeWidth ?? 2) : 0
  return (
    <div className={`cv-box kind-${el.type} ${selected ? 'selected' : ''} ${el.locked ? 'is-locked' : ''}`} data-cid={el.id} style={style}>
      {el.type === 'shape' && (
        <svg className="cv-shape" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <ShapePath kind={el.shape} w={w} h={h} fill={fillOf(el.fill)} stroke={el.stroke === 'none' || !sw ? 'transparent' : colorOf(el.stroke)} width={sw} />
        </svg>
      )}
      {editing ? (
        <AutoTextarea
          initial={el.text ?? ''}
          style={{ ...text, fontSize }}
          className={el.type === 'shape' ? 'centered' : ''}
          onDone={(t, measured) => onText(t, measured)}
        />
      ) : (
        <div ref={textRef} className={`cv-text ${el.type === 'shape' ? 'centered' : ''} ${el.align ? `align-${el.align}` : ''}`} style={text}>
          {el.text || (el.type === 'text' ? <span className="cv-placeholder">Text</span> : null)}
        </div>
      )}
    </div>
  )
}

function ShapePath({ kind, w, h, fill, stroke, width = 2 }: { kind: ShapeKind; w: number; h: number; fill: string; stroke: string; width?: number }) {
  const s = Math.max(0.5, width / 2)
  if (kind === 'ellipse') return <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - s)} ry={Math.max(0, h / 2 - s)} fill={fill} stroke={stroke} strokeWidth={width} />
  if (kind === 'diamond')
    return <polygon points={`${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`} fill={fill} stroke={stroke} strokeWidth={width} strokeLinejoin="round" />
  return <rect x={s} y={s} width={Math.max(0, w - 2 * s)} height={Math.max(0, h - 2 * s)} rx={8} fill={fill} stroke={stroke} strokeWidth={width} />
}

function FrameView({ el, selected, editing, onText }: { el: Extract<Element, { type: 'frame' }>; selected: boolean; editing: boolean; onText: (t: string) => void }) {
  const [x, y, w, h] = el.xywh
  return (
    <div className={`cv-frame ${selected ? 'selected' : ''}`} style={{ left: x, top: y, width: w, height: h, background: el.fill ? fillOf(el.fill) : undefined, opacity: el.opacity }} data-cid={el.id} data-part="frame-body">
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

function SelectionBox({ r, handles, id, rotatable, locked }: { r: Rect; handles: string[]; id: string | null; rotatable?: boolean; locked?: boolean }) {
  return (
    <div className={`cv-selection ${locked ? 'locked' : ''}`} style={box({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 })}>
      {handles.map((h) => (
        <div key={h} className={`cv-handle h-${h}`} data-cid={id ?? ''} data-part="handle" data-handle={h} />
      ))}
      {rotatable && id && <RotateHandle id={id} />}
    </div>
  )
}

/** The selection of one turned item: drawn turned, handles and all. */
function TurnedSelection({ r, deg, handles, id, rotatable }: { r: Rect; deg: number; handles: string[]; id: string | null; rotatable: boolean }) {
  return (
    <div className="cv-selection" style={{ ...box({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }), transform: `rotate(${deg}deg)` }}>
      {handles.map((h) => (
        <div key={h} className={`cv-handle h-${h}`} data-cid={id ?? ''} data-part="handle" data-handle={h} />
      ))}
      {rotatable && id && <RotateHandle id={id} />}
    </div>
  )
}

function RotateHandle({ id }: { id: string }) {
  return (
    <div className="cv-rotate" data-cid={id} data-part="handle" data-handle="rot" title="Drag to turn (Shift: 15° steps)">
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M21 3v5h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

