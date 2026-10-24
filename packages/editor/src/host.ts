import type { RefKind } from './schema'

export interface PageOption {
  id: string
  title: string
  icon: string
}

export interface BlockOption {
  id: string
  pageId: string
  text: string
}

/** What a reference currently points at, resolved by the host. */
export interface RefTarget {
  title: string
  icon?: string
  missing: boolean
}

/**
 * Everything the editor needs from the app around it. The editor package never talks to
 * storage or app state directly; the host decides how pages are found, created and opened.
 */
export interface EditorHost {
  /** Pages for the `[[` menu, best matches first. */
  searchPages(query: string): PageOption[] | Promise<PageOption[]>
  /** Create a page (from `[[` "Create …" or the Sub-page block) and return its id. */
  createPage(title: string, opts?: { subPageOf?: boolean }): Promise<string>
  /** Blocks for the `((` menu. */
  searchBlocks(query: string): Promise<BlockOption[]>
  /** React hook: the live title of a reference target. Re-renders when it changes. */
  useRefTarget(kind: RefKind, id: string): RefTarget
  openRef(kind: RefKind, id: string, newTab: boolean): void
  /** Show an emoji picker under `anchor`; resolves with the choice, or null if dismissed. */
  pickEmoji(anchor: DOMRect): Promise<string | null>
  /** Turn a dropped or pasted image file into an `src`. */
  readImage(file: File): Promise<string>
  openExternal(url: string): void
}
