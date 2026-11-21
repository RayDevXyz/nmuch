import type { JSONContent } from '@tiptap/core'
import type { RefKind } from './schema'

type TitleOf = (kind: RefKind, id: string) => string

function inline(nodes: JSONContent[] | undefined, titleOf: TitleOf): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '\n'
      if (n.type === 'ref') {
        const t = titleOf(n.attrs?.kind ?? 'page', n.attrs?.target ?? '')
        return n.attrs?.kind === 'block' ? `((${t}))` : `[[${t}]]`
      }
      let s = n.text ?? ''
      const marks = n.marks ?? []
      if (marks.some((m) => m.type === 'code')) return '`' + s + '`'
      if (marks.some((m) => m.type === 'bold')) s = `**${s}**`
      if (marks.some((m) => m.type === 'italic')) s = `*${s}*`
      if (marks.some((m) => m.type === 'strike')) s = `~~${s}~~`
      const link = marks.find((m) => m.type === 'link')
      if (link) s = `[${s}](${link.attrs?.href ?? ''})`
      return s
    })
    .join('')
}

function block(n: JSONContent, titleOf: TitleOf, indent: string): string[] {
  const kids = n.content ?? []
  switch (n.type) {
    case 'paragraph':
      return [indent + inline(kids, titleOf)]
    case 'heading':
      // The page title is the "#" heading, so note headings start one level down.
      return [indent + '#'.repeat(Math.min(6, (n.attrs?.level ?? 1) + 1)) + ' ' + inline(kids, titleOf)]
    case 'blockquote':
      return kids.flatMap((k) => block(k, titleOf, '')).map((l) => `${indent}> ${l}`)
    case 'callout':
      return [`${indent}> ${n.attrs?.icon ?? '💡'} ${inline(kids, titleOf)}`]
    case 'codeBlock':
      return [indent + '```' + (n.attrs?.language ?? ''), ...inline(kids, titleOf).split('\n').map((l) => indent + l), indent + '```']
    case 'horizontalRule':
      return [indent + '---']
    case 'image':
      return [`${indent}![${n.attrs?.caption ?? ''}](${n.attrs?.src ?? ''})`]
    case 'pageLink':
      return [`${indent}[[${titleOf('page', n.attrs?.pageId ?? '')}]]`]
    case 'table': {
      // GitHub-style table: the first row is the header row.
      const cell = (c: JSONContent) => (c.content ?? []).map((b) => inline(b.content, titleOf)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const rows = kids.map((r) => (r.content ?? []).map(cell))
      if (!rows.length) return []
      const width = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `${indent}| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
      return [line(rows[0]), `${indent}|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)]
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return kids.flatMap((item, i) => {
        const marker =
          n.type === 'orderedList' ? `${(n.attrs?.start ?? 1) + i}.` : n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-'
        const [first, ...rest] = item.content ?? []
        const head = first ? block(first, titleOf, '')[0] : ''
        return [`${indent}${marker} ${head}`, ...rest.flatMap((r) => block(r, titleOf, indent + '  '))]
      })
    default:
      return kids.flatMap((k) => block(k, titleOf, indent))
  }
}

const LISTS = ['bulletList', 'orderedList', 'taskList']

/** Markdown for a page: its title, then each note's content. */
export function toMarkdown(title: string, notes: JSONContent[], titleOf: TitleOf): string {
  const parts: string[] = []
  if (title) parts.push(`# ${title}`)
  for (const doc of notes) {
    const blocks = (doc.content ?? []).filter((b) => !(b.type === 'paragraph' && !b.content?.length))
    let body = ''
    blocks.forEach((b, i) => {
      const lines = block(b, titleOf, '').join('\n')
      body += i === 0 ? lines : (LISTS.includes(b.type ?? '') && LISTS.includes(blocks[i - 1].type ?? '') ? '\n' : '\n\n') + lines
    })
    if (body) parts.push(body)
  }
  return parts.join('\n\n') + '\n'
}
