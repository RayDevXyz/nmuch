import {
  CheckSquare,
  Code2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListOrdered,
  Minus,
  MessageSquareQuote,
  Pilcrow,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react'
import type { BlockType } from '../lib/types'

export interface SlashItem {
  id: BlockType
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
  { id: 'callout', label: 'Callout', desc: 'Make writing stand out', icon: Lightbulb, keywords: 'note info tip warning box' },
  { id: 'code', label: 'Code', desc: 'Code snippet', icon: Code2, keywords: 'snippet pre programming ```', hint: '```' },
  { id: 'divider', label: 'Divider', desc: 'Visual separator', icon: Minus, keywords: 'hr line separator rule ---', hint: '---' },
  { id: 'image', label: 'Image', desc: 'Upload an image', icon: Image, keywords: 'picture photo img upload' },
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

export const TURN_INTO: BlockType[] = ['text', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'code']

export const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  text: "Type '/' for commands",
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullet: 'List',
  numbered: 'List',
  todo: 'To-do',
  quote: 'Quote',
  callout: 'Callout',
}

export const labelOf = (t: BlockType) => SLASH_ITEMS.find((i) => i.id === t)?.label ?? t
export const iconOf = (t: BlockType) => SLASH_ITEMS.find((i) => i.id === t)?.icon ?? Pilcrow
