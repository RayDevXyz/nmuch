import { blockPlain, extractLinks, extractTags, sanitizeInline } from './html'
import type { Block, BlockType, BlockWrite } from './types'

export function toWrite(b: Block): BlockWrite {
  const text = b.type === 'code' ? b.text : sanitizeInline(b.text)
  const plain = blockPlain({ ...b, text })
  const links = b.type === 'page' && b.props.pageId ? [b.props.pageId] : extractLinks(text)
  return { ...b, text, plain, links, tags: extractTags(plain) }
}

export const TEXTUAL: BlockType[] = ['text', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'todo', 'quote', 'callout']
export const INDENTABLE: BlockType[] = ['text', 'bullet', 'numbered', 'todo']
/** Block types that continue on Enter */
export const CONTINUES: BlockType[] = ['bullet', 'numbered', 'todo']
export const isTextual = (t: BlockType) => TEXTUAL.includes(t)
