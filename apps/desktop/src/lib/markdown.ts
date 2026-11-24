import type { BlockProps, BlockType } from './types'

/**
 * Markdown -> blocks in the Nimbus-style flat format (inline HTML + props), which
 * `convert.ts` turns into Tiptap content. Used for pasted Markdown.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineMdToHtml(md: string, resolvePage?: (title: string) => string | null): string {
  let s = escapeHtml(md)
  const codes: string[] = []
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/\[\[([^\]]+)\]\]/g, (all, t) => {
    const id = resolvePage?.(t.trim())
    return id ? `<a class="page-link" data-page="${id}" contenteditable="false">${t.trim()}</a>` : all
  })
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`)
  s = s.replace(/\n/g, '<br>')
  return s
}

export interface ParsedBlock {
  type: BlockType
  text: string
  props: BlockProps
  /** Kept when importing from Nimbus, so blocks keep their identity. */
  id?: string
}

export function parseMarkdown(text: string, resolvePage?: (title: string) => string | null): ParsedBlock[] {
  const lines = joinWrapped(text.replace(/\r\n?/g, '\n').split('\n'))
  const out: ParsedBlock[] = []
  const inline = (s: string) => inlineMdToHtml(s, resolvePage)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^```\s*([\w+-]*)\s*$/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      out.push({ type: 'code', text: body.join('\n'), props: { lang: fence[1] || '' } })
      continue
    }
    if (!line.trim()) continue
    // A table: a "| a | b |" row, then a "| --- | :-: |" line, then more rows.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (l: string) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')))
      const rows = [cells(line)]
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]))
      i--
      out.push({ type: 'table', text: '', props: { rows } })
      continue
    }
    let m: RegExpMatchArray | null
    const indentOf = (ws: string) => Math.min(4, Math.floor(ws.replace(/\t/g, '  ').length / 2))
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = Math.min(3, m[1].length)
      out.push({ type: (`h${lvl}`) as BlockType, text: inline(m[2]), props: {} })
    } else if ((m = line.match(/^(\s*)[-*+]\s+\[( |x|X)\]\s?(.*)$/))) {
      out.push({ type: 'todo', text: inline(m[3]), props: { checked: m[2] !== ' ', indent: indentOf(m[1]) } })
    } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
      out.push({ type: 'bullet', text: inline(m[2]), props: { indent: indentOf(m[1]) } })
    } else if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) {
      out.push({ type: 'numbered', text: inline(m[2]), props: { indent: indentOf(m[1]) } })
    } else if ((m = line.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i))) {
      // A GitHub note ("> [!TIP]" and its "> " lines) becomes a callout.
      const body: string[] = []
      while (i + 1 < lines.length && /^>/.test(lines[i + 1])) body.push(lines[++i].replace(/^>\s?/, ''))
      const icon = ({ note: 'ℹ️', tip: '💡', important: '❗', warning: '⚠️', caution: '🛑' } as Record<string, string>)[m[1].toLowerCase()]
      out.push({ type: 'callout', text: inline(body.join(' ').trim()), props: { icon } })
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      out.push({ type: 'quote', text: inline(m[1]), props: {} })
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ type: 'divider', text: '', props: {} })
    } else if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
      out.push({ type: 'image', text: '', props: { src: m[2], caption: m[1] } })
    } else {
      out.push({ type: 'text', text: inline(line), props: {} })
    }
  }
  return out
}

/** A line that starts a block of its own (not the rest of a wrapped paragraph or list item). */
const STARTS = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\||(-{3,}|\*{3,}|_{3,})\s*$|!\[|<)/

/**
 * Markdown wraps long paragraphs and list items over several lines; join them back into one
 * line each, so a wrapped sentence stays one block. Code blocks are left alone.
 */
function joinWrapped(lines: string[]): string[] {
  const out: string[] = []
  let code = false
  for (const line of lines) {
    const fence = /^```/.test(line.trim())
    const prev = out[out.length - 1]
    const joinable =
      !code &&
      !fence &&
      !!line.trim() &&
      !STARTS.test(line) &&
      prev !== undefined &&
      !!prev.trim() &&
      !/^\s*(#{1,6}\s|```|\||(-{3,}|\*{3,}|_{3,})\s*$)/.test(prev) &&
      !/^>\s*\[!\w+\]\s*$/.test(prev)
    if (fence) code = !code
    if (joinable) out[out.length - 1] = `${prev.replace(/\s+$/, '')} ${line.trim()}`
    else out.push(line)
  }
  return out
}
