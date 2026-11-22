import type { Editor, JSONContent } from '@tiptap/core'
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
  /** Renders a widget block (sandboxed by the host; the core checks its data access). */
  WidgetBlock?: ComponentType<WidgetBlockProps>
  /**
   * A line `{{template: Name | Field: value}}` + Enter: use that template. Return null when the
   * line isn't one; otherwise a promise of the blocks to put in its place (null: leave it).
   */
  templateCall?(text: string): Promise<JSONContent[] | null> | null
  /** Renders a map of content: a live list of links to pages, from its settings. */
  MocBlock?: ComponentType<MocBlockProps>
  /** Extra `/` commands the app adds (templates, module blocks). */
  slashExtras?: SlashExtra[]
  /**
   * Something dragged in from the app (a bookmark from a side panel, say): the blocks to insert
   * where it's dropped, or null to let the editor handle the drop as usual.
   */
  dropContent?(data: DataTransfer): JSONContent[] | null
}

export interface WidgetBlockProps {
  widgetId: string
  /** The block's id: with the page id, this is the identity the core checks calls against. */
  blockId: string
  bindings: Record<string, unknown>
  settings: Record<string, unknown>
  editable: boolean
  onBindings(bindings: Record<string, unknown>): void
  onSettings(settings: Record<string, unknown>): void
}

export interface SlashExtra {
  id: string
  label: string
  desc: string
  keywords?: string
  /** The `/` menu tab it's listed under (e.g. "D&D", "Courses"); default "More". */
  group?: string
  /** Runs after the typed `/query` has been removed. */
  run(editor: Editor): void
}

export interface MocBlockProps {
  blockId: string
  settings: Record<string, unknown>
  editable: boolean
  onSettings(settings: Record<string, unknown>): void
}

export interface DatabaseBlockProps {
  databaseId: string
  viewId: string
  editable: boolean
  /** The user switched views inside the block; persist it on the node. */
  onViewChange(viewId: string): void
}
