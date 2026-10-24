import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bold, Code, Italic, Link2, Strikethrough, Underline } from 'lucide-react'

interface Props {
  root: React.RefObject<HTMLElement | null>
  /** called after a DOM-level change that does not fire an input event */
  onChanged: (el: HTMLElement) => void
}

function ceOf(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement
  return (el?.closest('.ce') as HTMLElement) ?? null
}

function insideTag(tag: string): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const n = sel.getRangeAt(0).commonAncestorContainer
  const el = n instanceof HTMLElement ? n : n.parentElement
  return (el?.closest(tag) as HTMLElement) ?? null
}

export function toggleInlineCode(onChanged: (el: HTMLElement) => void) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  const ce = ceOf(range.commonAncestorContainer)
  if (!ce) return
  const existing = insideTag('code')
  if (existing && ce.contains(existing)) {
    const text = document.createTextNode(existing.textContent ?? '')
    existing.replaceWith(text)
    const r = document.createRange()
    r.selectNodeContents(text)
    sel.removeAllRanges()
    sel.addRange(r)
  } else {
    if (range.collapsed) return
    const code = document.createElement('code')
    code.textContent = range.toString()
    range.deleteContents()
    range.insertNode(code)
    const r = document.createRange()
    r.selectNodeContents(code)
    sel.removeAllRanges()
    sel.addRange(r)
  }
  onChanged(ce)
}

export function InlineToolbar({ root, onChanged }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  const [url, setUrl] = useState('')
  const saved = useRef<Range | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    const onSel = () => {
      if (linkMode) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setPos(null)
      const range = sel.getRangeAt(0)
      const ce = ceOf(range.startContainer)
      if (!ce || !root.current?.contains(ce) || ceOf(range.endContainer) !== ce) return setPos(null)
      const rect = range.getBoundingClientRect()
      if (!rect.width && !rect.height) return setPos(null)
      setPos({ x: rect.left + rect.width / 2, y: rect.top })
      force((n) => n + 1)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [root, linkMode])

  const openLink = () => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    saved.current = sel.getRangeAt(0).cloneRange()
    const a = insideTag('a')
    setUrl(a?.getAttribute('href') ?? '')
    setLinkMode(true)
  }

  // Ctrl/Cmd+K with a text selection opens the link field (before the global quick-find binding)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && pos && !linkMode) {
        e.preventDefault()
        e.stopPropagation()
        openLink()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!pos) return null

  const exec = (cmd: string) => {
    document.execCommand(cmd)
    force((n) => n + 1)
  }

  const applyLink = () => {
    const r = saved.current
    setLinkMode(false)
    if (!r) return
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    const ce = ceOf(r.startContainer)
    ce?.focus({ preventScroll: true })
    sel?.removeAllRanges()
    sel?.addRange(r)
    const value = url.trim()
    if (!value) document.execCommand('unlink')
    else document.execCommand('createLink', false, /^(https?:|mailto:)/i.test(value) ? value : 'https://' + value)
    setPos(null)
  }

  const state = (cmd: string) => {
    try {
      return document.queryCommandState(cmd)
    } catch {
      return false
    }
  }

  return createPortal(
    <div className="inline-toolbar" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => !linkMode && e.preventDefault()}>
      {linkMode ? (
        <div className="link-edit">
          <Link2 size={13} />
          <input
            autoFocus
            value={url}
            placeholder="Paste or type a link…"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setLinkMode(false)
                setPos(null)
              }
            }}
            onBlur={() => setLinkMode(false)}
          />
        </div>
      ) : (
        <>
          <button className={state('bold') ? 'on' : ''} title="Bold (Ctrl B)" onClick={() => exec('bold')}>
            <Bold size={14} />
          </button>
          <button className={state('italic') ? 'on' : ''} title="Italic (Ctrl I)" onClick={() => exec('italic')}>
            <Italic size={14} />
          </button>
          <button className={state('underline') ? 'on' : ''} title="Underline (Ctrl U)" onClick={() => exec('underline')}>
            <Underline size={14} />
          </button>
          <button className={state('strikeThrough') ? 'on' : ''} title="Strikethrough (Ctrl Shift X)" onClick={() => exec('strikeThrough')}>
            <Strikethrough size={14} />
          </button>
          <button className={insideTag('code') ? 'on' : ''} title="Inline code (Ctrl E)" onClick={() => toggleInlineCode(onChanged)}>
            <Code size={14} />
          </button>
          <span className="tb-sep" />
          <button className={insideTag('a') ? 'on' : ''} title="Link (Ctrl K)" onClick={openLink}>
            <Link2 size={14} />
          </button>
        </>
      )}
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}
