import type { Block, BlockType, BlockProps } from './types'

const INLINE: Record<string, string> = {
  B: 'b',
  STRONG: 'b',
  I: 'i',
  EM: 'i',
  U: 'u',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  CODE: 'code',
  MARK: 'mark',
}

const SAFE_HREF = /^(https?:|mailto:)/i

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function walk(node: Node, parent: HTMLElement) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(child.textContent ?? ''))
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName
    if (tag === 'BR') {
      parent.appendChild(document.createElement('br'))
      return
    }
    if (INLINE[tag]) {
      const out = document.createElement(INLINE[tag])
      walk(el, out)
      if (out.childNodes.length) parent.appendChild(out)
      return
    }
    if (tag === 'A') {
      const pageId = el.getAttribute('data-page')
      const href = el.getAttribute('href') ?? ''
      if (pageId) {
        const a = document.createElement('a')
        a.className = 'page-link'
        a.setAttribute('data-page', pageId)
        a.setAttribute('contenteditable', 'false')
        a.textContent = el.textContent ?? ''
        parent.appendChild(a)
        return
      }
      if (SAFE_HREF.test(href)) {
        const a = document.createElement('a')
        a.setAttribute('href', href)
        walk(el, a)
        parent.appendChild(a)
        return
      }
    }
    if ((tag === 'DIV' || tag === 'P') && parent.childNodes.length) {
      parent.appendChild(document.createElement('br'))
    }
    walk(el, parent)
  })
}

/** Reduce arbitrary HTML to the small inline subset blocks are allowed to hold. */
export function sanitizeInline(html: string): string {
  if (!html) return ''
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const out = document.createElement('div')
  walk(tpl.content, out)
  const res = out.innerHTML
  return res === '<br>' ? '' : res
}

export function htmlToPlain(html: string): string {
  if (!html) return ''
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  return (tpl.content.textContent ?? '').replace(/ /g, ' ')
}

export function extractLinks(html: string): string[] {
  const out = new Set<string>()
  const re = /data-page="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.add(m[1])
  return [...out]
}

const TAG_RE = /(^|[\s(])#([\p{L}_][\p{L}\p{N}_\-/]*)/gu

export function extractTags(plain: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(plain))) out.add(m[2].toLowerCase())
  return [...out]
}

export function blockPlain(b: Pick<Block, 'type' | 'text' | 'props'>): string {
  if (b.type === 'code') return b.text
  if (b.type === 'image') return b.props.caption ?? ''
  if (b.type === 'divider' || b.type === 'page') return ''
  return htmlToPlain(b.text)
}

export function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g)
  return m ? m.length : 0
}

// ---------- Markdown export ----------

function inlineToMd(html: string, titleOf: (id: string) => string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const rec = (node: Node): string => {
    let s = ''
    node.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        s += (c.textContent ?? '').replace(/ /g, ' ')
        return
      }
      if (c.nodeType !== Node.ELEMENT_NODE) return
      const el = c as HTMLElement
      const inner = () => rec(el)
      switch (el.tagName) {
        case 'BR':
          s += '\n'
          break
        case 'B':
          s += `**${inner()}**`
          break
        case 'I':
          s += `*${inner()}*`
          break
        case 'S':
          s += `~~${inner()}~~`
          break
        case 'CODE':
          s += '`' + (el.textContent ?? '') + '`'
          break
        case 'A': {
          const pid = el.getAttribute('data-page')
          if (pid) s += `[[${titleOf(pid) || el.textContent}]]`
          else s += `[${inner()}](${el.getAttribute('href') ?? ''})`
          break
        }
        default:
          s += inner()
      }
    })
    return s
  }
  return rec(tpl.content)
}

const LISTY: BlockType[] = ['bullet', 'numbered', 'todo']

export function blocksToMarkdown(title: string, blocks: Block[], titleOf: (id: string) => string): string {
  const parts: string[] = []
  if (title) parts.push(`# ${title}`)
  const counters: number[] = []
  let prevListy = false
  let body = ''
  blocks.forEach((b, i) => {
    const indent = b.props.indent ?? 0
    const pad = '  '.repeat(indent)
    const md = inlineToMd(b.text, titleOf)
    let line = ''
    if (b.type === 'numbered') {
      counters[indent] = (counters[indent] ?? 0) + 1
      counters.length = indent + 1
    } else {
      counters.length = Math.min(counters.length, indent)
    }
    switch (b.type) {
      case 'h1':
        line = `## ${md}`
        break
      case 'h2':
        line = `### ${md}`
        break
      case 'h3':
        line = `#### ${md}`
        break
      case 'bullet':
        line = `${pad}- ${md}`
        break
      case 'numbered':
        line = `${pad}${counters[indent]}. ${md}`
        break
      case 'todo':
        line = `${pad}- [${b.props.checked ? 'x' : ' '}] ${md}`
        break
      case 'quote':
        line = md.split('\n').map((l) => `> ${l}`).join('\n')
        break
      case 'callout':
        line = md.split('\n').map((l, j) => `> ${j === 0 ? (b.props.icon ?? '💡') + ' ' : ''}${l}`).join('\n')
        break
      case 'code':
        line = '```' + (b.props.lang ?? '') + '\n' + b.text + '\n```'
        break
      case 'divider':
        line = '---'
        break
      case 'image':
        line = `![${b.props.caption ?? ''}](${b.props.src ?? ''})`
        break
      case 'page':
        line = `[[${titleOf(b.props.pageId ?? '')}]]`
        break
      default:
        line = md
    }
    const listy = LISTY.includes(b.type)
    if (i > 0) body += listy && prevListy ? '\n' : '\n\n'
    body += line
    prevListy = listy
  })
  if (body) parts.push(body)
  return parts.join('\n\n') + '\n'
}

// ---------- Markdown import (paste) ----------

export function inlineMdToHtml(md: string, resolvePage?: (title: string) => string | null): string {
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
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
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
