/** Is the caret on the last visual line of `el`? (The page title uses it for ArrowDown.) */
export function caretOnLastLine(el: HTMLElement): boolean {
  const sel = window.getSelection()
  const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
  if (!el.textContent || !r || !el.contains(r.startContainer)) return true
  const after = document.createRange()
  after.selectNodeContents(el)
  after.setStart(r.endContainer, r.endOffset)
  if (r.collapsed && !after.toString()) return true
  const rect = r.getClientRects()[0] ?? r.getBoundingClientRect()
  if (!rect || !(rect.width || rect.height || rect.top)) return false
  const lh = parseFloat(getComputedStyle(el).lineHeight)
  return el.getBoundingClientRect().bottom - rect.bottom < (isNaN(lh) ? 20 : lh) * 0.75
}
