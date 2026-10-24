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

export interface BlockProps {
  checked?: boolean
  indent?: number
  icon?: string
  lang?: string
  src?: string
  caption?: string
  pageId?: string
}

export interface Block {
  id: string
  pageId: string
  type: BlockType
  /** Inline HTML (sanitized) for rich blocks; raw source for code blocks. */
  text: string
  props: BlockProps
  /** Fractional index sort key. */
  key: string
}

export interface BlockWrite extends Block {
  plain: string
  links: string[]
  tags: string[]
}

export interface Page {
  id: string
  parentId: string | null
  title: string
  icon: string
  key: string
  favorite: boolean
  archived: boolean
  trashedAt: number | null
  createdAt: number
  updatedAt: number
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

export interface Storage {
  kind: 'sqlite' | 'browser'
  location(): Promise<string>
  listPages(): Promise<Page[]>
  upsertPage(page: Page): Promise<void>
  deletePages(ids: string[]): Promise<void>
  getBlocks(pageId: string): Promise<Block[]>
  saveBlocks(pageId: string, writes: BlockWrite[], deletes: string[], updatedAt: number): Promise<void>
  backlinks(pageId: string): Promise<Ref[]>
  mentions(pageId: string, title: string): Promise<Ref[]>
  links(): Promise<Link[]>
  tags(): Promise<TagCount[]>
  pagesWithTag(tag: string): Promise<string[]>
  search(query: string, limit: number): Promise<Hit[]>
}
