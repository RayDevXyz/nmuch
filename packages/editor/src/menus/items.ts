import type { Editor, Range } from '@tiptap/core'
import {
  CheckSquare,
  Code2,
  FileText,
  Table2,
  Grid3x3,
  Columns2,
  Columns3,
  Columns4,
  Map as MapIcon,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Lightbulb,
  List,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  Pilcrow,
  type LucideIcon,
} from 'lucide-react'
import { maybeHost } from '../host-extension'

export type SlashId =
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
  | 'database'
  | 'databasePage'
  | 'table'
  | 'moc'
  | 'columns2'
  | 'columns3'
  | 'columns4'

export interface SlashItem {
  id: SlashId
  label: string
  desc: string
  icon: LucideIcon
  keywords: string
  hint?: string
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: 'Text', desc: 'Plain paragraph', icon: Pilcrow, keywords: 'paragraph plain p' },
  { id: 'h1', label: 'Heading 1', desc: 'Big section heading', icon: Heading1, keywords: 'title h1 #', hint: '#' },
  { id: 'h2', label: 'Heading 2', desc: 'Medium section heading', icon: Heading2, keywords: 'subtitle h2 ##', hint: '##' },
  { id: 'h3', label: 'Heading 3', desc: 'Small section heading', icon: Heading3, keywords: 'h3 ###', hint: '###' },
  { id: 'bullet', label: 'Bulleted list', desc: 'Simple bulleted list', icon: List, keywords: 'ul unordered bullet -', hint: '-' },
  { id: 'numbered', label: 'Numbered list', desc: 'List with numbering', icon: ListOrdered, keywords: 'ol ordered number 1.', hint: '1.' },
  { id: 'todo', label: 'To-do', desc: 'Track tasks with a checkbox', icon: CheckSquare, keywords: 'task check checkbox todo []', hint: '[]' },
  { id: 'quote', label: 'Quote', desc: 'Capture a quote', icon: MessageSquareQuote, keywords: 'blockquote citation >', hint: '>' },
  { id: 'callout', label: 'Callout', desc: 'Make writing stand out', icon: Lightbulb, keywords: 'note info tip warning box', hint: '!>' },
  { id: 'code', label: 'Code', desc: 'Code snippet', icon: Code2, keywords: 'snippet pre programming ```', hint: '```' },
  { id: 'divider', label: 'Divider', desc: 'Visual separator', icon: Minus, keywords: 'hr line separator rule ---', hint: '---' },
  { id: 'image', label: 'Image', desc: 'Upload an image', icon: Image, keywords: 'picture photo img upload' },
  { id: 'table', label: 'Table', desc: 'A simple table of text', icon: Grid3x3, keywords: 'table grid rows columns cells simple |' },
  { id: 'columns2', label: '2 columns', desc: 'Two columns side by side', icon: Columns2, keywords: 'columns layout side split two grid' },
  { id: 'columns3', label: '3 columns', desc: 'Three columns side by side', icon: Columns3, keywords: 'columns layout side split three grid' },
  { id: 'columns4', label: '4 columns', desc: 'Four columns side by side', icon: Columns4, keywords: 'columns layout side split four grid' },
  { id: 'database', label: 'Database', desc: 'Table, board or gallery in this page', icon: Table2, keywords: 'table board kanban gallery inline db' },
  { id: 'databasePage', label: 'Database page', desc: 'A new database as its own page', icon: Table2, keywords: 'table board full page db' },
  { id: 'moc', label: 'Map of content', desc: 'Links to pages that stay up to date', icon: MapIcon, keywords: 'moc index overview toc contents links hub sub-pages children tag' },
  { id: 'page', label: 'Sub-page', desc: 'Nest a new page inside this one', icon: FileText, keywords: 'page subpage child document link' },
]

export function filterSlash(q: string): SlashItem[] {
  const query = q.trim().toLowerCase()
  if (!query) return SLASH_ITEMS
  const score = (i: SlashItem) => {
    const label = i.label.toLowerCase()
    if (label.startsWith(query)) return 0
    if (label.split(/[\s-]+/).some((w) => w.startsWith(query))) return 1
    if (label.includes(query)) return 2
    if (i.keywords.toLowerCase().split(' ').some((k) => k.startsWith(query))) return 3
    return i.keywords.toLowerCase().includes(query) ? 4 : -1
  }
  return SLASH_ITEMS.map((i) => [i, score(i)] as const)
    .filter(([, s]) => s >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([i]) => i)
}

/** Block types offered by "Turn into" in the block menu. */
export const TURN_INTO: SlashId[] = ['text', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'code']

export const slashItem = (id: SlashId) => SLASH_ITEMS.find((i) => i.id === id)!

function pickImages(editor: Editor) {
  const host = maybeHost(editor)
  if (!host) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = async () => {
    const files = [...(input.files ?? [])]
    const srcs = await Promise.all(files.map((f) => host.readImage(f)))
    editor.chain().focus().insertContent(srcs.map((src) => ({ type: 'image', attrs: { src, caption: '' } }))).run()
  }
  input.click()
}

/** Turn the current block into `id`, or insert it. `range` (the typed "/query") is removed first. */
export function runSlash(editor: Editor, id: SlashId, range?: Range) {
  const chain = () => (range ? editor.chain().focus().deleteRange(range) : editor.chain().focus())
  switch (id) {
    case 'text':
      return chain().clearNodes().setParagraph().run()
    case 'h1':
    case 'h2':
    case 'h3':
      return chain().clearNodes().setHeading({ level: Number(id[1]) as 1 | 2 | 3 }).run()
    case 'bullet':
      return chain().clearNodes().toggleBulletList().run()
    case 'numbered':
      return chain().clearNodes().toggleOrderedList().run()
    case 'todo':
      return chain().clearNodes().toggleTaskList().run()
    case 'quote':
      return chain().clearNodes().setParagraph().toggleBlockquote().run()
    case 'callout':
      return chain().clearNodes().setCallout().run()
    case 'code':
      return chain().clearNodes().setCodeBlock().run()
    case 'divider':
      return chain().setHorizontalRule().run()
    case 'table':
      return chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    case 'image':
      chain().run()
      return pickImages(editor)
    case 'database':
    case 'databasePage': {
      chain().run()
      const host = maybeHost(editor)
      void host?.createDatabase?.({ inline: id === 'database' }).then(({ databaseId, viewId }) => {
        if (id === 'database') editor.chain().focus().insertDatabase(databaseId, viewId).run()
        else editor.chain().focus().insertPageLink(databaseId).run()
      })
      return true
    }
    case 'columns2':
    case 'columns3':
    case 'columns4':
      return chain().insertColumns(Number(id.slice(-1))).run()
    case 'moc':
      return chain().insertMoc({ source: 'children' }).run()
    case 'page': {
      chain().run()
      const host = maybeHost(editor)
      void host?.createPage('', { subPageOf: true }).then((pageId) => {
        editor.chain().focus().insertPageLink(pageId).run()
      })
      return true
    }
  }
}
