import { useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type { Tool } from './chrome'
import type { CanvasNote, Element } from './model'
import type { Preset } from './SidePanel'

/**
 * The open canvas tells the right panel what it needs to show the canvas's assets (shapes, text,
 * pictures, layers) and act on them. One canvas at a time: the one on screen.
 */
export interface CanvasAssets {
  pageId: string
  tool: Tool
  onTool: (t: Tool) => void
  scene: boolean
  onAdd: (p: Preset) => void
  onUpload: () => void
  onAddImage: (img: { src: string; w: number; h: number }) => void
  doc: Y.Doc
  elements: Element[]
  notes: CanvasNote[]
  selected: string[]
  onSelect: (ids: string[]) => void
  onFocus: (id: string) => void
  /** Battle maps: add a prop from the library, the campaign (its library), the map's state, its layers. */
  onAddProp?: (asset: string) => void
  campaign?: string | null
  mapState?: import('../battlemap/compute').MapState | null
  onLayers?: (layers: import('../battlemap/model').MapSettings['layers']) => void
  /** A battle map's settings, for the right panel's Map and Table tabs. */
  scenePanel?: import('./scene').ScenePanelProps | null
  /** Battle maps: what the 5etools pictures in the prop library do. */
  fivee?: import('../battlemap/FiveeBrowser').FiveeActions | null
}

let current: CanvasAssets | null = null
const subs = new Set<() => void>()

export function publishCanvas(a: CanvasAssets) {
  current = a
  subs.forEach((f) => f())
}

/** The canvas of `pageId` is gone (only clears it if it's still that one). */
export function retractCanvas(pageId: string) {
  if (current?.pageId !== pageId) return
  current = null
  subs.forEach((f) => f())
}

export function useCanvasAssets(): CanvasAssets | null {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current,
  )
}
