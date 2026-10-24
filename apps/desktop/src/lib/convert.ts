import { ensureIds, schemaExtensions } from '@brainwaves/editor'
import { generateJSON, type JSONContent } from '@tiptap/core'
import { escapeHtml, parseMarkdown, type ParsedBlock } from './html'

const extensions = schemaExtensions()

const LIST: Partial<Record<ParsedBlock['type'], 'ul' | 'ol' | 'task'>> = { bullet: 'ul', numbered: 'ol', todo: 'task' }

/**
 * Nimbus-style flat blocks (inline HTML + `indent`) to HTML the Tiptap schema parses.
 * Consecutive list blocks become nested lists according to their indent.
 */
export function blocksToHTML(blocks: ParsedBlock[]): string {
  let html = ''
  let i = 0
  const list = (indent: number): string => {
    const kind = LIST[blocks[i].type]!
    const open = kind === 'ul' ? '<ul>' : kind === 'ol' ? '<ol>' : '<ul data-type="taskList">'
    let out = open
    while (i < blocks.length && LIST[blocks[i].type] === kind && (blocks[i].props.indent ?? 0) === indent) {
      const b = blocks[i++]
      const li = kind === 'task' ? `<li data-type="taskItem" data-checked="${b.props.checked ? 'true' : 'false'}">` : '<li>'
      let inner = `<p>${b.text}</p>`
      while (i < blocks.length && LIST[blocks[i].type] && (blocks[i].props.indent ?? 0) > indent) inner += list(blocks[i].props.indent ?? 0)
      out += li + inner + '</li>'
    }
    return out + (kind === 'ol' ? '</ol>' : '</ul>')
  }
  while (i < blocks.length) {
    const b = blocks[i]
    if (LIST[b.type]) {
      html += list(b.props.indent ?? 0)
      continue
    }
    i++
    switch (b.type) {
      case 'h1':
      case 'h2':
      case 'h3':
        html += `<${b.type}>${b.text}</${b.type}>`
        break
      case 'quote':
        html += `<blockquote><p>${b.text}</p></blockquote>`
        break
      case 'callout':
        html += `<div data-type="callout" data-icon="${escapeHtml(b.props.icon ?? '💡')}">${b.text}</div>`
        break
      case 'code':
        html += `<pre><code${b.props.lang ? ` class="language-${escapeHtml(b.props.lang)}"` : ''}>${escapeHtml(b.text)}</code></pre>`
        break
      case 'divider':
        html += '<hr>'
        break
      case 'image':
        html += `<figure data-type="image"><img src="${escapeHtml(b.props.src ?? '')}"><figcaption>${escapeHtml(b.props.caption ?? '')}</figcaption></figure>`
        break
      case 'page':
        html += `<div data-type="page-link" data-page-id="${escapeHtml(b.props.pageId ?? '')}"></div>`
        break
      default:
        html += `<p>${b.text}</p>`
    }
  }
  return html
}

/** Nimbus-style blocks to a ProseMirror document with block ids. */
export function blocksToDoc(blocks: ParsedBlock[]): JSONContent {
  return ensureIds(generateJSON(blocksToHTML(blocks), extensions))
}

/** Pasted Markdown to block content (see `EditorHost.markdownToContent`). */
export function markdownToContent(text: string, resolvePage?: (title: string) => string | null): JSONContent[] | null {
  const blocks = parseMarkdown(text, resolvePage)
  if (!blocks.length) return null
  return blocksToDoc(blocks).content ?? null
}
