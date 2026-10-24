import type { JSONContent } from '@tiptap/core'
import type { RefKind } from './schema'

export interface OutlineItem {
  id: string
  level: 1 | 2 | 3
  text: string
}

/** Plain text of a node's inline content; refs become their resolved titles. */
export function plainText(node: JSONContent, titleOf?: (kind: RefKind, id: string) => string): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'ref') return titleOf ? titleOf(node.attrs?.kind ?? 'page', node.attrs?.target ?? '') : ''
  return (node.content ?? []).map((c) => plainText(c, titleOf)).join('')
}

/** Headings in document order, for the outline panel. */
export function outlineOf(doc: JSONContent): OutlineItem[] {
  const out: OutlineItem[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'heading' && n.attrs?.id) {
      out.push({ id: n.attrs.id, level: Math.min(3, n.attrs.level ?? 1) as 1 | 2 | 3, text: plainText(n) })
    }
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

/** Words and text blocks, for the status bar. */
export function statsOf(doc: JSONContent): { words: number; blocks: number } {
  let words = 0
  let blocks = 0
  const walk = (n: JSONContent) => {
    if (n.type && ['paragraph', 'heading', 'codeBlock', 'callout', 'image', 'pageLink', 'horizontalRule'].includes(n.type)) {
      blocks++
      words += (plainText(n).match(/\S+/g) ?? []).length
      return
    }
    n.content?.forEach(walk)
  }
  walk(doc)
  return { words, blocks }
}
