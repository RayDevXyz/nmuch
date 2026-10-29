import type { JSONContent } from '@tiptap/core'
import type { ComponentType } from 'react'
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
  /**
   * Turn pasted plain text into blocks when it looks like Markdown. Return null to let the
   * editor paste it as text.
   */
  markdownToContent?(text: string): JSONContent[] | null
  /**
   * Create a database for the `/database` commands. `inline`: shown inside this page (the
   * database becomes a sub-page of it); otherwise a database page linked from here.
   */
  createDatabase?(opts: { inline: boolean }): Promise<{ databaseId: string; viewId: string }>
  /** Renders an inline database block (the editor only stores which database and view). */
  DatabaseBlock?: ComponentType<DatabaseBlockProps>
}

export interface DatabaseBlockProps {
  databaseId: string
  viewId: string
  editable: boolean
  /** The user switched views inside the block; persist it on the node. */
  onViewChange(viewId: string): void
}
