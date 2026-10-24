// Caret / selection helpers for per-block contentEditable elements.

export function selRange(): Range | null {
  const sel = window.getSelection()
  return sel && sel.rangeCount ? sel.getRangeAt(0) : null
}

function rangeWithin(el: HTMLElement): Range | null {
  const r = selRange()
  if (!r || !el.contains(r.startContainer)) return null
  return r
}

function fragHasContent(frag: DocumentFragment): boolean {
  return (frag.textContent ?? '').length > 0 || !!frag.querySelector('br,img,a')
}

export function caretAtStart(el: HTMLElement): boolean {
  const r = rangeWithin(el)
  if (!r || !r.collapsed) return false
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return !fragHasContent(pre.cloneContents())
}

export function caretAtEnd(el: HTMLElement): boolean {
  const r = rangeWithin(el)
  if (!r || !r.collapsed) return false
  const post = document.createRange()
  post.selectNodeContents(el)
  post.setStart(r.endContainer, r.endOffset)
  const frag = post.cloneContents()
  // a single trailing <br> is a contentEditable artefact
  if ((frag.textContent ?? '').length === 0) {
    const brs = frag.querySelectorAll('br').length
    return brs <= 1 && !frag.querySelector('img,a')
  }
  return false
}

/** Text offset of the caret from the start of el. */
export function caretOffset(el: HTMLElement): number {
  const r = rangeWithin(el)
  if (!r) return 0
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return pre.toString().length
}

function pointAt(el: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  let node = walker.nextNode()
  let last: Node | null = null
  while (node) {
    const len = node.textContent?.length ?? 0
    if (left <= len) return [node, left]
    left -= len
    last = node
    node = walker.nextNode()
  }
  if (last) return [last, last.textContent?.length ?? 0]
  return [el, el.childNodes.length]
}

export function rangeFromOffsets(el: HTMLElement, start: number, end: number): Range {
  const r = document.createRange()
  const [sn, so] = pointAt(el, start)
  const [en, eo] = pointAt(el, end)
  r.setStart(sn, so)
  r.setEnd(en, eo)
  return r
}

export function placeCaret(el: HTMLElement, where: 'start' | 'end' | number) {
  el.focus({ preventScroll: true })
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  if (where === 'start') {
    r.selectNodeContents(el)
    r.collapse(true)
  } else if (where === 'end') {
    r.selectNodeContents(el)
    r.collapse(false)
  } else {
    const [n, o] = pointAt(el, where)
    r.setStart(n, o)
    r.collapse(true)
  }
  sel.removeAllRanges()
  sel.addRange(r)
}

const serialize = (frag: DocumentFragment) => {
  const d = document.createElement('div')
  d.appendChild(frag)
  return d.innerHTML
}

/** HTML before and after the caret (deleting any selected content first). */
export function splitAtCaret(el: HTMLElement): [string, string] {
  const r = rangeWithin(el)
  if (!r) return [el.innerHTML, '']
  if (!r.collapsed) r.deleteContents()
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  const post = document.createRange()
  post.selectNodeContents(el)
  post.setStart(r.startContainer, r.startOffset)
  const clean = (h: string) => (h === '<br>' ? '' : h)
  return [clean(serialize(pre.cloneContents())), clean(serialize(post.cloneContents()))]
}

function caretRect(): DOMRect | null {
  const r = selRange()
  if (!r) return null
  const rects = r.getClientRects()
  if (rects.length) return rects[0]
  const rect = r.getBoundingClientRect()
  if (rect.width || rect.height || rect.top) return rect
  return null
}

function lineHeight(el: HTMLElement) {
  const lh = parseFloat(getComputedStyle(el).lineHeight)
  return isNaN(lh) ? 20 : lh
}

export function caretOnFirstLine(el: HTMLElement): boolean {
  if (!el.textContent) return true
  if (caretAtStart(el)) return true
  const rect = caretRect()
  if (!rect) return false
  const box = el.getBoundingClientRect()
  return rect.top - box.top < lineHeight(el) * 0.75
}

export function caretOnLastLine(el: HTMLElement): boolean {
  if (!el.textContent) return true
  if (caretAtEnd(el)) return true
  const rect = caretRect()
  if (!rect) return false
  const box = el.getBoundingClientRect()
  return box.bottom - rect.bottom < lineHeight(el) * 0.75
}

/** Viewport coordinates just under the caret (for menus). */
export function caretCoords(fallback?: HTMLElement): { x: number; y: number; top: number } {
  const rect = caretRect()
  if (rect && (rect.left || rect.top)) return { x: rect.left, y: rect.bottom, top: rect.top }
  const b = fallback?.getBoundingClientRect()
  return b ? { x: b.left, y: b.bottom, top: b.top } : { x: 0, y: 0, top: 0 }
}

/** Horizontal caret position, used to keep column when moving between blocks. */
export function caretX(): number | null {
  const rect = caretRect()
  return rect ? rect.left : null
}

/** Place caret in el on the first/last line nearest to x. */
export function placeCaretAtX(el: HTMLElement, x: number | null, line: 'first' | 'last') {
  if (x == null) return placeCaret(el, line === 'first' ? 'start' : 'end')
  const box = el.getBoundingClientRect()
  const lh = lineHeight(el)
  const y = line === 'first' ? box.top + Math.min(lh / 2, box.height / 2) : box.bottom - Math.min(lh / 2, box.height / 2)
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let range: Range | null = null
  if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y)
  else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) {
      range = document.createRange()
      range.setStart(p.offsetNode, p.offset)
    }
  }
  if (range && el.contains(range.startContainer)) {
    el.focus({ preventScroll: true })
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  } else {
    placeCaret(el, line === 'first' ? 'start' : 'end')
  }
}
