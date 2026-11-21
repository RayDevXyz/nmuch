/** Block types of the Nimbus-style flat format, used for sample pages, Markdown paste and the Nimbus import. */
export type BlockType =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'image'
  | 'page'
  | 'table'

export interface BlockProps {
  checked?: boolean
  indent?: number
  icon?: string
  lang?: string
  src?: string
  caption?: string
  pageId?: string
  /** Table cells as inline HTML, row by row; the first row is the header. */
  rows?: string[][]
}

export interface Page {
  id: string
  /** 'database' pages hold columns and views; their rows are pages with `databaseId` set. */
  kind: 'page' | 'database'
  databaseId: string | null
  parentId: string | null
  title: string
  icon: string
  key: string
  favorite: boolean
  archived: boolean
  trashedAt: number | null
  createdAt: number
  updatedAt: number
  /** The page's own theme id; empty: follow its parent; 'app': the app's theme. */
  theme?: string
}

export interface Ref {
  pageId: string
  blockId: string
  text: string
}

export interface Hit {
  pageId: string
  blockId: string | null
  text: string
}

export interface Link {
  source: string
  target: string
}

export interface TagCount {
  tag: string
  count: number
}

/** The fields of a page the core stores in its Y.Doc. */
export type PageMeta = Pick<Page, 'kind' | 'databaseId' | 'title' | 'icon' | 'parentId' | 'key' | 'favorite' | 'archived' | 'trashedAt' | 'theme'>

export interface BlockInfo {
  id: string
  pageId: string
  flavour: string
  text: string
}

/**
 * The app's view of storage: page metadata and index queries. Page *content* doesn't go
 * through here; editors sync a Y.Doc per page with the core (`lib/core/page-sync.ts`).
 */
export interface Storage {
  kind: 'sqlite' | 'dev'
  location(): Promise<string>
  listPages(): Promise<Page[]>
  createPage(page: Page): Promise<void>
  updatePage(id: string, patch: Partial<PageMeta>): Promise<void>
  deletePages(ids: string[]): Promise<void>
  backlinks(pageId: string): Promise<Ref[]>
  mentions(pageId: string, title: string): Promise<Ref[]>
  links(): Promise<Link[]>
  tags(): Promise<TagCount[]>
  pagesWithTag(tag: string): Promise<string[]>
  search(query: string, limit: number): Promise<Hit[]>
  blockInfos(ids: string[]): Promise<BlockInfo[]>
}
