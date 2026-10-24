import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowDown, ArrowUp, Copy, FilePlus2, ImagePlus, Smile, Trash2 } from 'lucide-react'
import { CONTINUES, INDENTABLE, isTextual } from '../lib/blocks'
import {
  caretAtEnd,
  caretAtStart,
  caretCoords,
  caretOffset,
  caretOnFirstLine,
  caretOnLastLine,
  caretX,
  placeCaret,
  placeCaretAtX,
  rangeFromOffsets,
  splitAtCaret,
} from '../lib/caret'
import { keyBetween, keysBetween } from '../lib/fractional'
import { blockPlain, blocksToMarkdown, escapeHtml, htmlToPlain, parseMarkdown, wordCount, type ParsedBlock } from '../lib/html'
import { uid } from '../lib/id'
import { db, openExternal } from '../lib/storage'
import { relativeTime } from '../lib/time'
import type { Block, BlockProps, BlockType, Page } from '../lib/types'
import { createPage, openPage, saveBlocks, titleOf, updatePage } from '../state/actions'
import { getState, setState, toast, useApp } from '../state/store'
import { EmojiPicker } from '../components/EmojiPicker'
import { MenuList, Popover } from '../components/Popover'
import { BlockView, type BlockApi } from './BlockView'
import { filterSlash, iconOf, labelOf, TURN_INTO, type SlashItem } from './blockTypes'
import { InlineToolbar, toggleInlineCode } from './InlineToolbar'

/** The editor that is currently mounted, so other UI can read unsaved blocks. */
export const activeEditor: { pageId: string | null; getBlocks: () => Block[]; flush: () => Promise<void> } = {
  pageId: null,
  getBlocks: () => [],
  flush: async () => {},
}

export async function pageMarkdown(pageId: string): Promise<string> {
  const page = getState().pages[pageId]
  const blocks = activeEditor.pageId === pageId ? activeEditor.getBlocks() : await db().getBlocks(pageId)
  return blocksToMarkdown(page?.title ?? '', blocks, titleOf)
}

type MenuKind = 'slash' | 'link'
interface MenuState {
  kind: MenuKind
  blockId: string
  start: number
  query: string
  index: number
  x: number
  y: number
  top: number
}
type LinkItem = { kind: 'page'; page: Page } | { kind: 'create'; title: string }

interface FocusReq {
  id: string
  at: 'start' | 'end' | number
  x?: number | null
  line?: 'first' | 'last'
}

const MD_PREFIX: Record<string, { type: BlockType; props?: BlockProps }> = {
  '#': { type: 'h1' },
  '##': { type: 'h2' },
  '###': { type: 'h3' },
  '-': { type: 'bullet' },
  '*': { type: 'bullet' },
  '+': { type: 'bullet' },
  '1.': { type: 'numbered' },
  '1)': { type: 'numbered' },
  '[]': { type: 'todo' },
  '[ ]': { type: 'todo' },
  '[x]': { type: 'todo', props: { checked: true } },
  '>': { type: 'quote' },
  '!>': { type: 'callout', props: { icon: '💡' } },
  '```': { type: 'code' },
}

function readFile(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })
}

/** Keep pasted photos reasonable: downscale anything big to max 2000px. */
async function imageToDataUrl(f: File): Promise<string> {
  const url = await readFile(f)
  if (f.size < 1.5e6 || f.type === 'image/gif' || f.type === 'image/svg+xml') return url
  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
  const out = c.toDataURL('image/webp', 0.86)
  return out.startsWith('data:image/webp') ? out : c.toDataURL('image/jpeg', 0.86)
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function Title({ page, onExit }: { page: Page; onExit: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== page.title) el.textContent = page.title
  }, [page.title])
  useEffect(() => {
    // brand-new, untitled pages start with the caret in the title
    if (!page.title && Date.now() - page.createdAt < 4000) ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])
  return (
    <h1
      ref={ref}
      className="page-title"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-placeholder="Untitled"
      spellCheck={false}
      onInput={(e) => {
        const el = e.currentTarget
        if (el.innerHTML === '<br>') el.innerHTML = ''
        updatePage(page.id, { title: (el.textContent ?? '').replace(/\n/g, ' ') }, 400)
      }}
      onPaste={(e) => {
        e.preventDefault()
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && caretOnLastLine(e.currentTarget))) {
          e.preventDefault()
          onExit()
        }
      }}
    />
  )
}

export function Editor({ pageId, scrollRef }: { pageId: string; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const page = useApp((s) => s.pages[pageId])
  const pages = useApp((s) => s.pages)
  const spellcheck = useApp((s) => s.spellcheck)
  const width = useApp((s) => s.width)
  const reveal = useApp((s) => s.reveal)
  const words = useApp((s) => s.stats.words)
  const now = useNow(30000)

  const [loaded, setLoaded] = useState(false)
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const blocksRef = useRef<Block[]>([])
  const dirty = useRef(new Set<string>())
  const deleted = useRef(new Set<string>())
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const publishTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const history = useRef<Block[][]>([])
  const future = useRef<Block[][]>([])
  const lastType = useRef(0)
  const focusReq = useRef<FocusReq | null>(null)
  const focusedId = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingImage = useRef<{ afterId: string | null; replaceId: string | null }>({ afterId: null, replaceId: null })
  const lastOutline = useRef('')

  const [selected, setSelectedState] = useState<Set<string>>(new Set())
  const selectedRef = useRef(selected)
  const selAnchor = useRef<string | null>(null)
  const setSelected = (s: Set<string>) => {
    selectedRef.current = s
    setSelectedState(s)
  }

  const [menu, setMenuState] = useState<MenuState | null>(null)
  const menuRef = useRef<MenuState | null>(null)
  const setMenu = (m: MenuState | null) => {
    menuRef.current = m
    setMenuState(m)
  }

  const [drag, setDrag] = useState<{ ids: string[]; overId: string; pos: 'before' | 'after' } | null>(null)
  const [blockMenu, setBlockMenu] = useState<{ blockId: string; x: number; y: number } | null>(null)
  const [iconPicker, setIconPicker] = useState<{ blockId: string | null; x: number; y: number } | null>(null)
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  // ---------- persistence ----------

  const flush = useCallback(() => {
    clearTimeout(saveTimer.current)
    if (!dirty.current.size && !deleted.current.size) return Promise.resolve()
    const map = new Map(blocksRef.current.map((b) => [b.id, b]))
    const writes = [...dirty.current].map((id) => map.get(id)).filter((b): b is Block => !!b)
    const dels = [...deleted.current]
    dirty.current.clear()
    deleted.current.clear()
    return saveBlocks(pageId, writes, dels)
  }, [pageId])

  const publish = () => {
    clearTimeout(publishTimer.current)
    publishTimer.current = setTimeout(() => {
      const bs = blocksRef.current
      const outline = bs
        .filter((b) => b.type === 'h1' || b.type === 'h2' || b.type === 'h3')
        .map((b) => ({ id: b.id, type: b.type as 'h1' | 'h2' | 'h3', text: htmlToPlain(b.text) }))
      const o = JSON.stringify(outline)
      if (o !== lastOutline.current) {
        lastOutline.current = o
        setState({ outline })
      }
      const w = bs.reduce((n, b) => n + wordCount(blockPlain(b)), 0)
      const s = getState().stats
      if (s.words !== w || s.blocks !== bs.length) setState({ stats: { words: w, blocks: bs.length } })
    }, 120)
  }

  const commit = (next: Block[], changed: Iterable<string> = [], removed: Iterable<string> = []) => {
    blocksRef.current = next
    for (const id of changed) {
      deleted.current.delete(id)
      dirty.current.add(id)
    }
    for (const id of removed) {
      dirty.current.delete(id)
      deleted.current.add(id)
    }
    rerender()
    publish()
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 400)
  }

  useEffect(() => {
    let alive = true
    setState({ outline: [], currentHeading: null })
    lastOutline.current = ''
    db()
      .getBlocks(pageId)
      .then((bs) => {
        if (!alive) return
        blocksRef.current = bs.length ? bs : [{ id: uid(), pageId, type: 'text', text: '', props: {}, key: keyBetween(null, null) }]
        setLoaded(true)
        publish()
      })
    const onHide = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', flush)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  useEffect(() => {
    activeEditor.pageId = pageId
    activeEditor.getBlocks = () => blocksRef.current
    activeEditor.flush = flush
    return () => {
      if (activeEditor.pageId === pageId) {
        activeEditor.pageId = null
        activeEditor.getBlocks = () => []
      }
    }
  }, [pageId, flush])

  // ---------- helpers ----------

  const bs = () => blocksRef.current
  const indexOf = (id: string) => bs().findIndex((b) => b.id === id)
  const get = (id: string) => bs().find((b) => b.id === id)
  const elOf = (id: string) => containerRef.current?.querySelector(`[data-ce="${id}"]`) as HTMLElement | null
  const newBlock = (type: BlockType, key: string, props: BlockProps = {}, text = ''): Block => ({ id: uid(), pageId, type, text, props, key })

  const checkpoint = () => {
    history.current.push(bs())
    if (history.current.length > 200) history.current.shift()
    future.current = []
  }

  const typingCheckpoint = () => {
    const t = Date.now()
    if (t - lastType.current > 1000) checkpoint()
    lastType.current = t
  }

  const restore = (target: Block[]) => {
    const cur = bs()
    const curMap = new Map(cur.map((b) => [b.id, b]))
    const ids = new Set(target.map((b) => b.id))
    const changed = target.filter((b) => curMap.get(b.id) !== b).map((b) => b.id)
    const removed = cur.filter((b) => !ids.has(b.id)).map((b) => b.id)
    const fid = focusedId.current && ids.has(focusedId.current) ? focusedId.current : changed[0] ?? target[target.length - 1]?.id
    if (fid) focusReq.current = { id: fid, at: 'end' }
    lastType.current = 0
    commit(target, changed, removed)
  }
  const undo = () => {
    const prev = history.current.pop()
    if (!prev) return
    future.current.push(bs())
    restore(prev)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    history.current.push(bs())
    restore(next)
  }

  const replace = (id: string, patch: Partial<Block>) => {
    const next = bs().map((b) => (b.id === id ? { ...b, ...patch } : b))
    commit(next, [id])
  }

  /** Insert blocks after index i (-1 = at the start). */
  const insertAt = (i: number, items: Omit<Block, 'key'>[], base: Block[] = bs()) => {
    const keys = keysBetween(base[i]?.key ?? null, base[i + 1]?.key ?? null, items.length)
    const created = items.map((it, k) => ({ ...it, key: keys[k] }) as Block)
    return { next: [...base.slice(0, i + 1), ...created, ...base.slice(i + 1)], created }
  }

  const focusNow = (f: FocusReq) => {
    const el = elOf(f.id)
    if (!el) return
    if (el instanceof HTMLTextAreaElement) {
      el.focus({ preventScroll: true })
      const pos = f.at === 'start' ? 0 : f.at === 'end' ? el.value.length : f.at
      el.setSelectionRange(pos, pos)
    } else if (el.isContentEditable) {
      if (f.line) placeCaretAtX(el, f.x ?? null, f.line)
      else placeCaret(el, f.at)
    } else {
      el.focus({ preventScroll: true })
    }
    const scroller = scrollRef.current
    if (scroller) {
      const r = el.getBoundingClientRect()
      const s = scroller.getBoundingClientRect()
      if (r.bottom > s.bottom - 40) scroller.scrollTop += r.bottom - s.bottom + 80
      else if (r.top < s.top + 40) scroller.scrollTop -= s.top - r.top + 80
    }
  }

  useLayoutEffect(() => {
    const f = focusReq.current
    if (!f) return
    focusReq.current = null
    focusNow(f)
  })

  const textToHtml = (s: string) => escapeHtml(s).replace(/\n/g, '<br>')

  const converted = (b: Block, type: BlockType, text = b.text): Block => {
    let t = text
    if (type === 'code' && b.type !== 'code') t = htmlToPlain(text)
    else if (type !== 'code' && b.type === 'code') t = textToHtml(text)
    const props: BlockProps = {}
    if (INDENTABLE.includes(type) && b.props.indent) props.indent = b.props.indent
    if (type === 'todo') props.checked = type === b.type ? b.props.checked : false
    if (type === 'callout') props.icon = b.props.icon || '💡'
    if (type === 'code') props.lang = b.props.lang ?? ''
    return { ...b, type, text: t, props }
  }

  const turnInto = (id: string, type: BlockType, at: FocusReq['at'] = 'end') => {
    const b = get(id)
    if (!b || b.type === type) return
    checkpoint()
    focusReq.current = { id, at }
    commit(
      bs().map((x) => (x.id === id ? converted(x, type) : x)),
      [id],
    )
  }

  const setIndent = (ids: string[], delta: number) => {
    const list = bs()
    const next = list.map((b, i) => {
      if (!ids.includes(b.id) || !INDENTABLE.includes(b.type)) return b
      const cur = b.props.indent ?? 0
      const prev = list[i - 1]
      const max = prev ? (prev.props.indent ?? 0) + 1 : 0
      const val = Math.max(0, Math.min(delta > 0 ? max : cur, cur + delta, 6))
      return val === cur ? b : { ...b, props: { ...b.props, indent: val } }
    })
    const changed = next.filter((b, i) => b !== list[i]).map((b) => b.id)
    if (!changed.length) return
    checkpoint()
    commit(next, changed)
  }

  const removeBlocks = (ids: string[], focus: 'prev' | 'next' = 'prev') => {
    const list = bs()
    const first = list.findIndex((b) => ids.includes(b.id))
    let next = list.filter((b) => !ids.includes(b.id))
    const created: string[] = []
    if (!next.length) {
      const b = newBlock('text', keyBetween(null, null))
      next = [b]
      created.push(b.id)
    }
    checkpoint()
    const target = focus === 'prev' ? next[Math.max(0, first - 1)] : next[Math.min(first, next.length - 1)]
    if (target) focusReq.current = { id: target.id, at: focus === 'prev' ? 'end' : 'start' }
    commit(next, created, ids)
  }

  const duplicate = (ids: string[]) => {
    const list = bs()
    const lastIdx = Math.max(...ids.map((id) => list.findIndex((b) => b.id === id)))
    const copies = list.filter((b) => ids.includes(b.id)).map((b) => ({ ...b, id: uid() }))
    checkpoint()
    const { next, created } = insertAt(lastIdx, copies)
    commit(next, created.map((b) => b.id))
    return created
  }

  const moveBlocks = (ids: string[], targetId: string, pos: 'before' | 'after') => {
    if (ids.includes(targetId)) return
    const list = bs()
    const moving = list.filter((b) => ids.includes(b.id))
    const rest = list.filter((b) => !ids.includes(b.id))
    const ti = rest.findIndex((b) => b.id === targetId)
    if (ti < 0) return
    const at = pos === 'before' ? ti - 1 : ti
    checkpoint()
    const { next, created } = insertAt(at, moving, rest)
    commit(next, created.map((b) => b.id))
  }

  const moveBy = (id: string, dir: -1 | 1) => {
    const list = bs()
    const i = list.findIndex((b) => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    moveBlocks([id], list[j].id, dir < 0 ? 'before' : 'after')
    focusReq.current = { id, at: 'end' }
  }

  const selectBlocks = (ids: string[], anchor?: string) => {
    setSelected(new Set(ids))
    selAnchor.current = anchor ?? ids[0] ?? null
    if (ids.length) {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      window.getSelection()?.removeAllRanges()
      containerRef.current?.focus({ preventScroll: true })
    }
  }

  const selectedIds = () => bs().filter((b) => selectedRef.current.has(b.id)).map((b) => b.id)

  const copySelection = async (ids: string[]) => {
    const blocks = bs().filter((b) => ids.includes(b.id))
    const md = blocksToMarkdown('', blocks, titleOf).trim()
    await navigator.clipboard?.writeText(md)
    toast(`Copied ${blocks.length} block${blocks.length === 1 ? '' : 's'} as Markdown`)
  }

  const resolveTitle = (title: string) => {
    const t = title.toLowerCase()
    return Object.values(getState().pages).find((p) => p.trashedAt == null && p.title.toLowerCase() === t)?.id ?? null
  }

  /** Insert parsed blocks at the caret of block `b`. */
  const insertParsed = (b: Block, el: HTMLElement, parsed: ParsedBlock[]) => {
    const [before, after] = splitAtCaret(el)
    const list = bs()
    const i = list.findIndex((x) => x.id === b.id)
    const cur = list[i]
    checkpoint()
    const items = parsed.map((p) => ({ id: uid(), pageId, type: p.type, text: p.text, props: p.props }))
    let base = list
    const changed: string[] = []
    const beforeEmpty = !htmlToPlain(before).trim()
    if (beforeEmpty && isTextual(cur.type)) {
      // replace the current (empty) block with the first parsed one
      const first = items.shift()!
      base = list.map((x) => (x.id === cur.id ? { ...x, type: first.type, text: first.text, props: first.props } : x))
      changed.push(cur.id)
    } else if (items[0] && items[0].type === 'text' && isTextual(cur.type)) {
      const first = items.shift()!
      base = list.map((x) => (x.id === cur.id ? { ...x, text: before + first.text } : x))
      changed.push(cur.id)
    } else {
      base = list.map((x) => (x.id === cur.id ? { ...x, text: before } : x))
      changed.push(cur.id)
    }
    if (htmlToPlain(after).trim()) items.push({ id: uid(), pageId, type: 'text', text: after, props: {} })
    const { next, created } = insertAt(i, items, base)
    const last = created[created.length - 1]?.id ?? cur.id
    focusReq.current = { id: last, at: 'end' }
    commit(next, [...changed, ...created.map((c) => c.id)])
  }

  const insertImages = async (files: File[], afterId: string | null, replaceId: string | null = null) => {
    const srcs = await Promise.all(files.map(imageToDataUrl))
    const list = bs()
    checkpoint()
    let base = list
    let at = afterId ? list.findIndex((b) => b.id === afterId) : list.length - 1
    const changed: string[] = []
    const items = srcs.map((src) => ({ id: uid(), pageId, type: 'image' as BlockType, text: '', props: { src, caption: '' } }))
    if (replaceId) {
      const first = items.shift()!
      base = list.map((b) => (b.id === replaceId ? { ...b, type: 'image', text: '', props: first.props } : b))
      changed.push(replaceId)
      at = list.findIndex((b) => b.id === replaceId)
    }
    let { next, created } = insertAt(at, items, base)
    const lastId = created[created.length - 1]?.id ?? replaceId
    const li = next.findIndex((b) => b.id === lastId)
    let focusId = lastId
    if (li === next.length - 1) {
      const r = insertAt(li, [{ id: uid(), pageId, type: 'text', text: '', props: {} }], next)
      next = r.next
      created = [...created, ...r.created]
      focusId = r.created[0].id
    }
    if (focusId) focusReq.current = { id: focusId, at: 'start' }
    commit(next, [...changed, ...created.map((c) => c.id)])
  }

  // ---------- menus ----------

  const linkItems = (q: string): LinkItem[] => {
    const query = q.trim().toLowerCase()
    const all = Object.values(getState().pages).filter((p) => p.trashedAt == null && p.id !== pageId)
    const matches = all
      .filter((p) => !query || (p.title || 'untitled').toLowerCase().includes(query))
      .sort((a, b) => {
        const as = (a.title || '').toLowerCase().startsWith(query) ? 0 : 1
        const bsx = (b.title || '').toLowerCase().startsWith(query) ? 0 : 1
        return as - bsx || b.updatedAt - a.updatedAt
      })
      .slice(0, 8)
      .map((page): LinkItem => ({ kind: 'page', page }))
    if (query && !all.some((p) => p.title.toLowerCase() === query)) matches.push({ kind: 'create', title: q.trim() })
    return matches
  }

  const menuCount = (m: MenuState) => (m.kind === 'slash' ? filterSlash(m.query).length : linkItems(m.query).length)

  const openMenu = (kind: MenuKind, b: Block, el: HTMLElement, start: number) => {
    const c = caretCoords(el)
    setMenu({ kind, blockId: b.id, start, query: '', index: 0, x: c.x, y: c.y, top: c.top })
  }

  /** Remove the "/query" or "[[query" text the menu was opened with. */
  const stripTrigger = (m: MenuState) => {
    const el = elOf(m.blockId)
    if (!el) return null
    const end = Math.max(caretOffset(el), m.start)
    rangeFromOffsets(el, m.start, end).deleteContents()
    if (el.innerHTML === '<br>') el.innerHTML = ''
    return el
  }

  const chooseSlash = async (item: SlashItem) => {
    const m = menuRef.current
    if (!m) return
    setMenu(null)
    const el = stripTrigger(m)
    const b = get(m.blockId)
    if (!el || !b) return
    const html = el.innerHTML
    const empty = !htmlToPlain(html).trim() && !el.querySelector('a,img')
    checkpoint()
    let list = bs().map((x) => (x.id === b.id ? { ...x, text: html } : x))
    const i = list.findIndex((x) => x.id === b.id)
    const changed = [b.id]
    if (item.id === 'image') {
      blocksRef.current = list
      dirty.current.add(b.id)
      pendingImage.current = { afterId: b.id, replaceId: empty ? b.id : null }
      fileInput.current?.click()
      return
    }
    if (item.id === 'page') {
      const child = await createPage({ parentId: pageId, open: false })
      list = bs().map((x) => (x.id === b.id ? { ...x, text: html } : x))
      if (empty) list = list.map((x) => (x.id === b.id ? { ...x, type: 'page' as BlockType, text: '', props: { pageId: child.id } } : x))
      else {
        const r = insertAt(i, [{ id: uid(), pageId, type: 'page', text: '', props: { pageId: child.id } }], list)
        list = r.next
        changed.push(r.created[0].id)
      }
      commit(list, changed)
      await flush()
      openPage(child.id, 'replace')
      return
    }
    if (item.id === 'divider') {
      let next = list
      if (empty) next = list.map((x) => (x.id === b.id ? { ...x, type: 'divider' as BlockType, text: '', props: {} } : x))
      else {
        const r = insertAt(i, [{ id: uid(), pageId, type: 'divider', text: '', props: {} }], list)
        next = r.next
        changed.push(r.created[0].id)
      }
      const di = next.findIndex((x, k) => k >= i && x.type === 'divider')
      const r2 = insertAt(di, [{ id: uid(), pageId, type: 'text', text: '', props: {} }], next)
      changed.push(r2.created[0].id)
      focusReq.current = { id: r2.created[0].id, at: 'start' }
      commit(r2.next, changed)
      return
    }
    if (empty) {
      list = list.map((x) => (x.id === b.id ? converted(x, item.id, '') : x))
      focusReq.current = { id: b.id, at: 'start' }
      commit(list, changed)
    } else {
      const base = converted({ ...newBlock('text', ''), props: {} }, item.id, '')
      const r = insertAt(i, [{ id: base.id, pageId, type: base.type, text: '', props: base.props }], list)
      focusReq.current = { id: base.id, at: 'start' }
      commit(r.next, [...changed, base.id])
    }
  }

  const chooseLink = async (item: LinkItem) => {
    const m = menuRef.current
    if (!m) return
    setMenu(null)
    const target = item.kind === 'page' ? item.page : await createPage({ title: item.title, open: false })
    const el = elOf(m.blockId)
    if (!el) return
    el.focus({ preventScroll: true })
    const end = Math.max(caretOffset(el), m.start)
    const range = rangeFromOffsets(el, m.start, end)
    range.deleteContents()
    const a = document.createElement('a')
    a.className = 'page-link'
    a.setAttribute('data-page', target.id)
    a.setAttribute('contenteditable', 'false')
    a.textContent = target.title || 'Untitled'
    const space = document.createTextNode(' ')
    range.insertNode(space)
    range.insertNode(a)
    const sel = window.getSelection()
    const r = document.createRange()
    r.setStartAfter(space)
    r.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(r)
    checkpoint()
    replace(m.blockId, { text: el.innerHTML })
  }

  // ---------- event handlers (re-created each render, called through a stable api) ----------

  const handlers = {
    onInput(block: Block, el: HTMLElement, data: string | null, inputType: string) {
      if (el.innerHTML === '<br>') el.innerHTML = ''
      const cur = get(block.id)
      if (!cur) return
      typingCheckpoint()
      const plain = el.textContent ?? ''
      // Markdown shortcuts at the start of a plain text block
      if (cur.type === 'text' && inputType === 'insertText') {
        const off = caretOffset(el)
        if (data === ' ' || data === ' ') {
          const prefix = plain.slice(0, off - 1)
          const rule = MD_PREFIX[prefix]
          if (rule) {
            rangeFromOffsets(el, 0, off).deleteContents()
            const html = el.innerHTML === '<br>' ? '' : el.innerHTML
            checkpoint()
            const conv = converted({ ...cur, text: html }, rule.type)
            focusReq.current = { id: cur.id, at: 'start' }
            replace(cur.id, { ...conv, props: { ...conv.props, ...rule.props } })
            return
          }
        }
        if (data === '-' && plain === '---') {
          checkpoint()
          const i = indexOf(cur.id)
          const list = bs().map((x) => (x.id === cur.id ? { ...x, type: 'divider' as BlockType, text: '', props: {} } : x))
          const r = insertAt(i, [{ id: uid(), pageId, type: 'text', text: '', props: {} }], list)
          focusReq.current = { id: r.created[0].id, at: 'start' }
          commit(r.next, [cur.id, r.created[0].id])
          return
        }
        if (data === '`' && plain === '```') {
          checkpoint()
          focusReq.current = { id: cur.id, at: 'start' }
          replace(cur.id, converted({ ...cur, text: '' }, 'code'))
          return
        }
      }
      replace(cur.id, { text: el.innerHTML })

      // slash and [[ menus
      const off = caretOffset(el)
      const m = menuRef.current
      if (data === '/' && cur.type !== 'code') {
        const prev = plain[off - 2]
        if (off === 1 || prev === undefined || /\s/.test(prev)) return openMenu('slash', cur, el, off - 1)
      }
      if (data === '[' && plain.slice(off - 2, off) === '[[') return openMenu('link', cur, el, off - 2)
      if (m && m.blockId === cur.id) {
        const trig = m.kind === 'slash' ? '/' : '[['
        if (off < m.start + trig.length || plain.slice(m.start, m.start + trig.length) !== trig) return setMenu(null)
        const q = plain.slice(m.start + trig.length, off)
        if (q.length > 40 || (m.kind === 'link' && q.includes(']]')) || (m.kind === 'slash' && /\s\s/.test(q))) return setMenu(null)
        if (m.kind === 'slash' && filterSlash(q).length === 0 && q.length > 6) return setMenu(null)
        setMenu({ ...m, query: q, index: 0 })
      }
    },

    onKeyDown(e: KeyboardEvent<HTMLElement>, block: Block, el: HTMLElement) {
      const cur = get(block.id)
      if (!cur) return
      const ne = e.nativeEvent
      if (ne.isComposing) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key
      const i = indexOf(cur.id)
      const list = bs()

      // menu navigation
      const m = menuRef.current
      if (m && m.blockId === cur.id) {
        const count = menuCount(m)
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          e.preventDefault()
          if (count) setMenu({ ...m, index: (m.index + (key === 'ArrowDown' ? 1 : -1) + count) % count })
          return
        }
        if ((key === 'Enter' || key === 'Tab') && count) {
          e.preventDefault()
          if (m.kind === 'slash') chooseSlash(filterSlash(m.query)[m.index])
          else chooseLink(linkItems(m.query)[m.index])
          return
        }
        if (key === 'Escape') {
          e.preventDefault()
          setMenu(null)
          return
        }
        if (key === 'Enter') setMenu(null)
      }

      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault()
        return redo()
      }

      // non-text blocks (divider, image, sub-page): simple navigation
      if (!isTextual(cur.type)) {
        if (key === 'ArrowUp' || key === 'ArrowLeft') {
          e.preventDefault()
          if (list[i - 1]) focusNow({ id: list[i - 1].id, at: 'end' })
        } else if (key === 'ArrowDown' || key === 'ArrowRight') {
          e.preventDefault()
          if (list[i + 1]) focusNow({ id: list[i + 1].id, at: 'start' })
        } else if (key === 'Backspace' || key === 'Delete') {
          e.preventDefault()
          removeBlocks([cur.id], key === 'Backspace' ? 'prev' : 'next')
        } else if (key === 'Enter') {
          e.preventDefault()
          if (cur.type === 'page' && cur.props.pageId) return openPage(cur.props.pageId, mod ? 'tab' : 'replace')
          checkpoint()
          const r = insertAt(i, [{ id: uid(), pageId, type: 'text', text: '', props: {} }])
          focusReq.current = { id: r.created[0].id, at: 'start' }
          commit(r.next, [r.created[0].id])
        } else if (key === 'Escape') {
          e.preventDefault()
          selectBlocks([cur.id])
        } else if (mod && key.toLowerCase() === 'd') {
          e.preventDefault()
          duplicate([cur.id])
        }
        return
      }

      // formatting & block shortcuts
      if (mod && !e.shiftKey && key.toLowerCase() === 'e') {
        e.preventDefault()
        return toggleInlineCode((x) => handlers.syncFromDom(x))
      }
      if (mod && e.shiftKey && key.toLowerCase() === 'x') {
        e.preventDefault()
        document.execCommand('strikeThrough')
        return
      }
      if (mod && key.toLowerCase() === 'd') {
        e.preventDefault()
        const c = duplicate([cur.id])
        if (c[0]) focusReq.current = { id: c[0].id, at: 'end' }
        return
      }
      if (mod && e.altKey && /^Digit[0-3]$/.test(e.code)) {
        e.preventDefault()
        const t = (['text', 'h1', 'h2', 'h3'] as BlockType[])[Number(e.code.slice(5))]
        return turnInto(cur.id, t)
      }
      if (mod && e.shiftKey && /^Digit[7-9]$/.test(e.code)) {
        e.preventDefault()
        const t = ({ Digit7: 'numbered', Digit8: 'bullet', Digit9: 'todo' } as Record<string, BlockType>)[e.code]
        return turnInto(cur.id, t)
      }
      if (e.altKey && e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        e.preventDefault()
        return moveBy(cur.id, key === 'ArrowUp' ? -1 : 1)
      }
      if (mod && key === 'Enter' && cur.type === 'todo') {
        e.preventDefault()
        checkpoint()
        return replace(cur.id, { props: { ...cur.props, checked: !cur.props.checked } })
      }
      if (mod && key.toLowerCase() === 'a') {
        const sel = window.getSelection()
        const len = (el.textContent ?? '').length
        if (!len || (sel && sel.toString().length >= len)) {
          e.preventDefault()
          selectBlocks(list.map((b) => b.id))
        }
        return
      }

      switch (key) {
        case 'Enter': {
          if (e.shiftKey) {
            e.preventDefault()
            document.execCommand('insertLineBreak')
            return
          }
          e.preventDefault()
          const empty = !(el.textContent ?? '').length && !el.querySelector('img,a')
          if (CONTINUES.includes(cur.type) && empty) {
            if ((cur.props.indent ?? 0) > 0) {
              setIndent([cur.id], -1)
              focusReq.current = { id: cur.id, at: 'start' }
              return
            }
            return turnInto(cur.id, 'text', 'start')
          }
          checkpoint()
          const contType: BlockType = CONTINUES.includes(cur.type) ? cur.type : 'text'
          const props: BlockProps = INDENTABLE.includes(contType) && cur.props.indent ? { indent: cur.props.indent } : {}
          if (caretAtStart(el) && !empty) {
            const r = insertAt(i - 1, [{ id: uid(), pageId, type: contType, text: '', props }])
            focusReq.current = { id: cur.id, at: 'start' }
            commit(r.next, [r.created[0].id])
            return
          }
          const [before, after] = splitAtCaret(el)
          const base = list.map((x) => (x.id === cur.id ? { ...x, text: before } : x))
          const r = insertAt(i, [{ id: uid(), pageId, type: contType, text: after, props }], base)
          focusReq.current = { id: r.created[0].id, at: 'start' }
          commit(r.next, [cur.id, r.created[0].id])
          return
        }
        case 'Backspace': {
          if (!caretAtStart(el)) return
          if (cur.type !== 'text') {
            e.preventDefault()
            return turnInto(cur.id, 'text', 'start')
          }
          if ((cur.props.indent ?? 0) > 0) {
            e.preventDefault()
            setIndent([cur.id], -1)
            focusReq.current = { id: cur.id, at: 'start' }
            return
          }
          const prev = list[i - 1]
          if (!prev) return
          e.preventDefault()
          const curEmpty = !(el.textContent ?? '').length && !el.querySelector('img,a')
          if (!isTextual(prev.type)) {
            if (prev.type === 'code') {
              if (curEmpty) return removeBlocks([cur.id], 'prev')
              return focusNow({ id: prev.id, at: 'end' })
            }
            checkpoint()
            focusReq.current = { id: cur.id, at: 'start' }
            return commit(
              list.filter((x) => x.id !== prev.id),
              [],
              [prev.id],
            )
          }
          checkpoint()
          const prevEl = elOf(prev.id)
          const prevLen = prevEl ? (prevEl.textContent ?? '').length : htmlToPlain(prev.text).length
          const strip = (h: string) => h.replace(/<br>$/, '')
          const merged = strip(prev.text) + (el.innerHTML === '<br>' ? '' : el.innerHTML)
          const next = list.filter((x) => x.id !== cur.id).map((x) => (x.id === prev.id ? { ...x, text: merged } : x))
          focusReq.current = { id: prev.id, at: prevLen }
          commit(next, [prev.id], [cur.id])
          return
        }
        case 'Delete': {
          if (!caretAtEnd(el)) return
          const nx = list[i + 1]
          if (!nx) return
          e.preventDefault()
          if (!isTextual(nx.type)) {
            if (nx.type === 'code') return
            checkpoint()
            focusReq.current = { id: cur.id, at: 'end' }
            return commit(
              list.filter((x) => x.id !== nx.id),
              [],
              [nx.id],
            )
          }
          checkpoint()
          const len = (el.textContent ?? '').length
          const merged = (el.innerHTML === '<br>' ? '' : el.innerHTML.replace(/<br>$/, '')) + nx.text
          const next = list.filter((x) => x.id !== nx.id).map((x) => (x.id === cur.id ? { ...x, text: merged } : x))
          focusReq.current = { id: cur.id, at: len }
          commit(next, [cur.id], [nx.id])
          return
        }
        case 'ArrowUp': {
          if (!caretOnFirstLine(el)) return
          if (e.shiftKey) {
            e.preventDefault()
            return selectBlocks(list.slice(Math.max(0, i - 1), i + 1).map((b) => b.id), cur.id)
          }
          const prev = list[i - 1]
          if (!prev) return
          e.preventDefault()
          focusNow({ id: prev.id, at: 'end', x: caretX(), line: 'last' })
          return
        }
        case 'ArrowDown': {
          if (!caretOnLastLine(el)) return
          if (e.shiftKey) {
            e.preventDefault()
            return selectBlocks(list.slice(i, i + 2).map((b) => b.id), cur.id)
          }
          const nx = list[i + 1]
          if (!nx) return
          e.preventDefault()
          focusNow({ id: nx.id, at: 'start', x: caretX(), line: 'first' })
          return
        }
        case 'ArrowLeft': {
          if (e.shiftKey || !caretAtStart(el) || !list[i - 1]) return
          e.preventDefault()
          return focusNow({ id: list[i - 1].id, at: 'end' })
        }
        case 'ArrowRight': {
          if (e.shiftKey || !caretAtEnd(el) || !list[i + 1]) return
          e.preventDefault()
          return focusNow({ id: list[i + 1].id, at: 'start' })
        }
        case 'Tab': {
          e.preventDefault()
          return setIndent([cur.id], e.shiftKey ? -1 : 1)
        }
        case 'Escape': {
          e.preventDefault()
          return selectBlocks([cur.id])
        }
      }
    },

    onCodeKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, block: Block, ta: HTMLTextAreaElement) {
      const cur = get(block.id)
      if (!cur) return
      const mod = e.ctrlKey || e.metaKey
      const list = bs()
      const i = indexOf(cur.id)
      const { selectionStart: s, selectionEnd: en, value } = ta
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        return redo()
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          const ls = value.lastIndexOf('\n', s - 1) + 1
          const n = value.slice(ls, ls + 2).match(/^ {1,2}/)?.[0].length ?? 0
          if (n) {
            ta.setRangeText('', ls, ls + n, 'preserve')
            ta.setSelectionRange(Math.max(ls, s - n), Math.max(ls, en - n))
          }
        } else ta.setRangeText('  ', s, en, 'end')
        return handlers.onCodeInput(cur, ta.value)
      }
      if (e.key === 'Enter' && mod) {
        e.preventDefault()
        checkpoint()
        const r = insertAt(i, [{ id: uid(), pageId, type: 'text', text: '', props: {} }])
        focusReq.current = { id: r.created[0].id, at: 'start' }
        return commit(r.next, [r.created[0].id])
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const ls = value.lastIndexOf('\n', s - 1) + 1
        const ind = value.slice(ls).match(/^[ \t]*/)?.[0] ?? ''
        ta.setRangeText('\n' + ind, s, en, 'end')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return selectBlocks([cur.id])
      }
      if (e.key === 'Backspace' && value === '') {
        e.preventDefault()
        return turnInto(cur.id, 'text', 'start')
      }
      if (e.key === 'ArrowUp' && s === en && !value.slice(0, s).includes('\n') && list[i - 1]) {
        e.preventDefault()
        return focusNow({ id: list[i - 1].id, at: 'end' })
      }
      if (e.key === 'ArrowDown' && s === en && !value.slice(en).includes('\n')) {
        e.preventDefault()
        if (list[i + 1]) return focusNow({ id: list[i + 1].id, at: 'start' })
        checkpoint()
        const r = insertAt(i, [{ id: uid(), pageId, type: 'text', text: '', props: {} }])
        focusReq.current = { id: r.created[0].id, at: 'start' }
        return commit(r.next, [r.created[0].id])
      }
    },

    onCodeInput(block: Block, value: string) {
      typingCheckpoint()
      replace(block.id, { text: value })
    },

    onPaste(e: React.ClipboardEvent<HTMLElement>, block: Block, el: HTMLElement) {
      const cd = e.clipboardData
      const files = [...cd.files].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        const empty = !(el.textContent ?? '').trim()
        insertImages(files, block.id, empty ? block.id : null)
        return
      }
      const text = cd.getData('text/plain')
      e.preventDefault()
      if (!text) return
      const sel = window.getSelection()
      const trimmed = text.trim()
      if (/^(https?:\/\/|mailto:)\S+$/.test(trimmed) && sel && !sel.isCollapsed) {
        document.execCommand('createLink', false, trimmed)
        return
      }
      const norm = text.replace(/\r\n?/g, '\n')
      const blocky = /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s|```)/m.test(norm)
      if (!norm.includes('\n') && !blocky) {
        document.execCommand('insertText', false, norm)
        return
      }
      if (!norm.trim().includes('\n') && !blocky) {
        document.execCommand('insertText', false, norm.trim())
        return
      }
      const parsed = parseMarkdown(norm, resolveTitle)
      if (parsed.length) insertParsed(block, el, parsed)
    },

    onFocus(block: Block) {
      focusedId.current = block.id
      if (selectedRef.current.size) setSelected(new Set())
    },

    onClickContent(e: React.MouseEvent<HTMLElement>) {
      const t = e.target as HTMLElement
      const pl = t.closest('a.page-link') as HTMLElement | null
      if (pl) {
        e.preventDefault()
        const id = pl.getAttribute('data-page')
        if (id && getState().pages[id]) openPage(id, e.ctrlKey || e.metaKey || e.button === 1 ? 'tab' : 'replace')
        else toast('That page no longer exists')
        return
      }
      const a = t.closest('a[href]') as HTMLAnchorElement | null
      if (a && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        openExternal(a.href)
      }
    },

    setProps(block: Block, props: Partial<BlockProps>, cp?: boolean) {
      const cur = get(block.id)
      if (!cur) return
      if (cp) checkpoint()
      else typingCheckpoint()
      replace(cur.id, { props: { ...cur.props, ...props } })
    },

    onHandleDown(e: PointerEvent<HTMLElement>, block: Block) {
      if (e.button !== 0) return
      e.preventDefault()
      const sx = e.clientX
      const sy = e.clientY
      const shift = e.shiftKey
      const handleRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const ids = selectedRef.current.has(block.id) ? selectedIds() : [block.id]
      let dragging = false
      let last: { overId: string; pos: 'before' | 'after' } | null = null
      const move = (ev: globalThis.PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        if (!dragging) {
          dragging = true
          document.body.classList.add('dragging-block')
          if (!selectedRef.current.has(block.id)) selectBlocks([block.id])
        }
        const rows = [...(containerRef.current?.querySelectorAll('[data-block-row]') ?? [])] as HTMLElement[]
        let best: { el: HTMLElement; d: number } | null = null
        for (const r of rows) {
          const rect = r.getBoundingClientRect()
          const d = ev.clientY < rect.top ? rect.top - ev.clientY : ev.clientY > rect.bottom ? ev.clientY - rect.bottom : 0
          if (!best || d < best.d) best = { el: r, d }
        }
        if (!best) return
        const rect = best.el.getBoundingClientRect()
        const overId = best.el.getAttribute('data-block-row')!
        const pos = ev.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        last = { overId, pos }
        setDrag({ ids, overId, pos })
        const sc = scrollRef.current
        if (sc) {
          const sr = sc.getBoundingClientRect()
          if (ev.clientY < sr.top + 40) sc.scrollTop -= 12
          else if (ev.clientY > sr.bottom - 40) sc.scrollTop += 12
        }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.classList.remove('dragging-block')
        setDrag(null)
        if (dragging) {
          if (last && !ids.includes(last.overId)) moveBlocks(ids, last.overId, last.pos)
          return
        }
        // click
        if (shift && selAnchor.current) {
          const list = bs()
          const a = list.findIndex((b) => b.id === selAnchor.current)
          const z = list.findIndex((b) => b.id === block.id)
          const [lo, hi] = a < z ? [a, z] : [z, a]
          selectBlocks(
            list.slice(lo, hi + 1).map((b) => b.id),
            selAnchor.current,
          )
          return
        }
        selectBlocks([block.id])
        setBlockMenu({ blockId: block.id, x: handleRect.left, y: handleRect.bottom })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },

    addBelow(block: Block) {
      const i = indexOf(block.id)
      const cur = get(block.id)
      if (!cur) return
      checkpoint()
      const r = insertAt(i, [{ id: uid(), pageId, type: 'text', text: '/', props: {} }])
      const id = r.created[0].id
      focusReq.current = { id, at: 'end' }
      commit(r.next, [id])
      requestAnimationFrame(() => {
        const el = elOf(id)
        const nb = get(id)
        if (el && nb) openMenu('slash', nb, el, 0)
      })
    },

    openIconPicker(block: Block, anchor: HTMLElement) {
      const r = anchor.getBoundingClientRect()
      setIconPicker({ blockId: block.id, x: r.left, y: r.bottom })
    },

    openPage(id: string, newTab: boolean) {
      openPage(id, newTab ? 'tab' : 'replace')
    },

    selectBlock(block: Block) {
      selectBlocks([block.id])
    },

    syncFromDom(el: HTMLElement) {
      const id = el.getAttribute('data-ce')
      if (!id) return
      checkpoint()
      replace(id, { text: el.innerHTML })
    },
  }

  const impl = useRef(handlers)
  impl.current = handlers

  const api: BlockApi = useMemo(
    () => ({
      onInput: (...a) => impl.current.onInput(...a),
      onKeyDown: (...a) => impl.current.onKeyDown(...a),
      onCodeKeyDown: (...a) => impl.current.onCodeKeyDown(...a),
      onCodeInput: (...a) => impl.current.onCodeInput(...a),
      onPaste: (...a) => impl.current.onPaste(...a),
      onFocus: (...a) => impl.current.onFocus(...a),
      onClickContent: (e) => impl.current.onClickContent(e),
      setProps: (...a) => impl.current.setProps(...a),
      onHandleDown: (...a) => impl.current.onHandleDown(...a),
      addBelow: (...a) => impl.current.addBelow(...a),
      openIconPicker: (...a) => impl.current.openIconPicker(...a),
      openPage: (...a) => impl.current.openPage(...a),
      selectBlock: (...a) => impl.current.selectBlock(...a),
      spellcheck,
    }),
    [spellcheck],
  )

  useEffect(() => {
    if (menu) document.querySelector('.slash-menu .menu-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [menu])

  // ---------- block-selection keyboard ----------

  const onContainerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== containerRef.current || !selectedRef.current.size) return
    const ids = selectedIds()
    const list = bs()
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (mod && k.toLowerCase() === 'z') {
      e.preventDefault()
      setSelected(new Set())
      return e.shiftKey ? redo() : undo()
    }
    if (k === 'Escape') {
      e.preventDefault()
      return setSelected(new Set())
    }
    if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault()
      setSelected(new Set())
      return removeBlocks(ids, 'prev')
    }
    if (k === 'Enter') {
      e.preventDefault()
      const id = ids[ids.length - 1]
      setSelected(new Set())
      return focusNow({ id, at: 'end' })
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault()
      const first = list.findIndex((b) => b.id === ids[0])
      const last = list.findIndex((b) => b.id === ids[ids.length - 1])
      if (e.altKey && e.shiftKey) {
        const target = k === 'ArrowUp' ? list[first - 1] : list[last + 1]
        if (target) moveBlocks(ids, target.id, k === 'ArrowUp' ? 'before' : 'after')
        return
      }
      if (e.shiftKey) {
        const anchor = list.findIndex((b) => b.id === selAnchor.current)
        const head = anchor === first ? last : first
        const nh = Math.max(0, Math.min(list.length - 1, head + (k === 'ArrowUp' ? -1 : 1)))
        const [lo, hi] = anchor < nh ? [anchor, nh] : [nh, anchor]
        return selectBlocks(
          list.slice(lo, hi + 1).map((b) => b.id),
          selAnchor.current ?? undefined,
        )
      }
      const ni = k === 'ArrowUp' ? Math.max(0, first - 1) : Math.min(list.length - 1, last + 1)
      return selectBlocks([list[ni].id])
    }
    if (k === 'Tab') {
      e.preventDefault()
      return setIndent(ids, e.shiftKey ? -1 : 1)
    }
    if (mod && k.toLowerCase() === 'a') {
      e.preventDefault()
      return selectBlocks(list.map((b) => b.id))
    }
    if (mod && k.toLowerCase() === 'c') {
      e.preventDefault()
      copySelection(ids)
      return
    }
    if (mod && k.toLowerCase() === 'x') {
      e.preventDefault()
      copySelection(ids).then(() => {
        setSelected(new Set())
        removeBlocks(ids, 'prev')
      })
      return
    }
    if (mod && k.toLowerCase() === 'd') {
      e.preventDefault()
      const c = duplicate(ids)
      return selectBlocks(c.map((b) => b.id))
    }
  }

  // clear block selection when clicking elsewhere
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!selectedRef.current.size) return
      const t = e.target as HTMLElement
      if (t.closest('.handle, .popover')) return
      setSelected(new Set())
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [])

  // ---------- rubber-band selection ----------

  const onScrollPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('[data-ce], button, input, textarea, .popover, .page-title, .note-icon-wrap, .inline-toolbar, a, img')) return
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    const move = (ev: globalThis.PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
      if (!active) {
        active = true
        window.getSelection()?.removeAllRanges()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
      }
      ev.preventDefault()
      setBand({ x0, y0, x1: ev.clientX, y1: ev.clientY })
      const top = Math.min(y0, ev.clientY)
      const bottom = Math.max(y0, ev.clientY)
      const rows = [...(containerRef.current?.querySelectorAll('[data-block-row]') ?? [])] as HTMLElement[]
      const hit = rows
        .filter((r) => {
          const rect = r.getBoundingClientRect()
          return rect.bottom > top && rect.top < bottom
        })
        .map((r) => r.getAttribute('data-block-row')!)
      setSelected(new Set(hit))
      selAnchor.current = hit[0] ?? null
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setBand(null)
      if (active && selectedRef.current.size) containerRef.current?.focus({ preventScroll: true })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---------- reveal / outline tracking / link titles ----------

  useEffect(() => {
    if (!loaded || !reveal || reveal.pageId !== pageId) return
    const row = containerRef.current?.querySelector(`[data-block-row="${reveal.blockId}"]`) as HTMLElement | null
    setState({ reveal: null })
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.add('flash')
    setTimeout(() => row.classList.remove('flash'), 1400)
  }, [loaded, reveal, pageId])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top = sc.getBoundingClientRect().top + 90
        let current: string | null = null
        sc.querySelectorAll('.block-row.b-h1, .block-row.b-h2, .block-row.b-h3').forEach((r) => {
          if (r.getBoundingClientRect().top < top) current = r.getAttribute('data-block-row')
        })
        if (getState().currentHeading !== current) setState({ currentHeading: current })
      })
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => sc.removeEventListener('scroll', onScroll)
  }, [scrollRef, loaded])

  useEffect(() => {
    containerRef.current?.querySelectorAll('a.page-link').forEach((a) => {
      const id = a.getAttribute('data-page') ?? ''
      const p = pages[id]
      const live = p && p.trashedAt == null
      const title = live ? p.title || 'Untitled' : a.textContent
      if (live && a.textContent !== title) a.textContent = title
      a.classList.toggle('missing', !live)
    })
  })

  // ---------- render ----------

  if (!page) return null
  const list = blocksRef.current
  const numbers: number[] = []
  const counters: number[] = []
  list.forEach((b) => {
    const ind = b.props.indent ?? 0
    if (b.type === 'numbered') {
      counters[ind] = (counters[ind] ?? 0) + 1
      counters.length = ind + 1
      numbers.push(counters[ind])
    } else {
      counters.length = Math.min(counters.length, b.type === 'text' && ind === 0 ? 0 : ind)
      numbers.push(0)
    }
  })

  const focusFirst = () => {
    const first = list[0]
    if (first) focusNow({ id: first.id, at: 'start' })
  }

  const tailClick = () => {
    const last = list[list.length - 1]
    if (last && isTextual(last.type) && !htmlToPlain(last.text).trim()) return focusNow({ id: last.id, at: 'end' })
    checkpoint()
    const r = insertAt(list.length - 1, [{ id: uid(), pageId, type: 'text', text: '', props: {} }])
    focusReq.current = { id: r.created[0].id, at: 'start' }
    commit(r.next, [r.created[0].id])
  }

  const menuBlock = blockMenu ? get(blockMenu.blockId) : undefined
  const readMin = Math.max(1, Math.round(words / 200))

  return (
    <div
      className="note-scroll"
      ref={scrollRef}
      onPointerDown={onScrollPointerDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return
        e.preventDefault()
        const row = (e.target as HTMLElement).closest('[data-block-row]')
        insertImages(files, row?.getAttribute('data-block-row') ?? null)
      }}
    >
      <article className={`note-canvas ${width === 'wide' ? 'wide' : ''}`}>
        <div className="note-meta">
          <span>Updated {relativeTime(page.updatedAt, now)}</span>
          <span>•</span>
          <span>{readMin} min read</span>
        </div>
        <div className="note-icon-wrap">
          {page.icon ? (
            <button
              className="note-icon"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setIconPicker({ blockId: null, x: r.left, y: r.bottom })
              }}
            >
              {page.icon}
            </button>
          ) : (
            <button
              className="add-icon"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setIconPicker({ blockId: null, x: r.left, y: r.bottom })
              }}
            >
              <Smile size={14} /> Add icon
            </button>
          )}
        </div>
        <Title page={page} onExit={focusFirst} />
        <div className={`blocks ${selected.size ? 'has-selection' : ''}`} ref={containerRef} tabIndex={-1} onKeyDown={onContainerKeyDown}>
          {loaded &&
            list.map((b, i) => (
              <BlockView
                key={b.id}
                block={b}
                number={numbers[i]}
                selected={selected.has(b.id)}
                drop={drag && drag.overId === b.id ? drag.pos : null}
                api={api}
              />
            ))}
        </div>
        <div className="editor-tail" onClick={tailClick} />
      </article>

      <InlineToolbar root={containerRef} onChanged={(el) => handlers.syncFromDom(el)} />

      {menu && (
        <Popover x={menu.x} y={menu.y} anchorTop={menu.top} onClose={() => setMenu(null)} className="slash-menu" keepFocus>
          {menu.kind === 'slash' ? (
            <div className="menu-list">
              <div className="menu-caption">{menu.query ? `Blocks matching “${menu.query}”` : 'Basic blocks'}</div>
              {filterSlash(menu.query).map((item, i) => (
                <button
                  key={item.id}
                  className={`menu-item rich ${i === menu.index ? 'active' : ''}`}
                  onMouseEnter={() => setMenu({ ...menu, index: i })}
                  onClick={() => chooseSlash(item)}
                >
                  <span className="menu-tile">
                    <item.icon size={16} />
                  </span>
                  <span className="menu-text">
                    <strong>{item.label}</strong>
                    <small>{item.desc}</small>
                  </span>
                  {item.hint && <kbd className="menu-hint">{item.hint}</kbd>}
                </button>
              ))}
              {filterSlash(menu.query).length === 0 && <div className="menu-empty">No matching blocks</div>}
            </div>
          ) : (
            <div className="menu-list">
              <div className="menu-caption">Link to page</div>
              {linkItems(menu.query).map((item, i) => (
                <button
                  key={item.kind === 'page' ? item.page.id : 'create'}
                  className={`menu-item ${i === menu.index ? 'active' : ''}`}
                  onMouseEnter={() => setMenu({ ...menu, index: i })}
                  onClick={() => chooseLink(item)}
                >
                  {item.kind === 'page' ? (
                    <>
                      <span className="menu-icon">{item.page.icon || '📄'}</span>
                      <span className="menu-label">{item.page.title || 'Untitled'}</span>
                    </>
                  ) : (
                    <>
                      <span className="menu-icon">
                        <FilePlus2 size={14} />
                      </span>
                      <span className="menu-label">
                        Create “{item.title}”
                      </span>
                    </>
                  )}
                </button>
              ))}
              {linkItems(menu.query).length === 0 && <div className="menu-empty">Type to search pages</div>}
            </div>
          )}
        </Popover>
      )}

      {blockMenu && menuBlock && (
        <Popover x={blockMenu.x} y={blockMenu.y} onClose={() => setBlockMenu(null)} className="block-menu">
          <div className="menu-caption">Turn into</div>
          <div className="turn-grid">
            {TURN_INTO.map((t) => {
              const Icon = iconOf(t)
              return (
                <button
                  key={t}
                  className={`turn-item ${menuBlock.type === t ? 'current' : ''}`}
                  title={labelOf(t)}
                  onClick={() => {
                    const ids = selectedRef.current.size > 1 ? selectedIds() : [menuBlock.id]
                    setBlockMenu(null)
                    setSelected(new Set())
                    if (ids.length > 1) {
                      const convertible = (b: Block) => ids.includes(b.id) && (isTextual(b.type) || b.type === 'code')
                      checkpoint()
                      commit(
                        bs().map((b) => (convertible(b) ? converted(b, t) : b)),
                        ids,
                      )
                    } else turnInto(menuBlock.id, t)
                  }}
                >
                  <Icon size={15} />
                  <span>{labelOf(t)}</span>
                </button>
              )
            })}
          </div>
          <div className="menu-sep" />
          <MenuList
            onDone={() => setBlockMenu(null)}
            items={[
              ...(menuBlock.type === 'callout'
                ? [
                    {
                      label: 'Change icon',
                      icon: <Smile size={14} />,
                      onSelect: () => setIconPicker({ blockId: menuBlock.id, x: blockMenu.x, y: blockMenu.y }),
                    },
                  ]
                : []),
              {
                label: 'Duplicate',
                icon: <Copy size={14} />,
                hint: 'Ctrl D',
                onSelect: () => {
                  const ids = selectedRef.current.size ? selectedIds() : [menuBlock.id]
                  const c = duplicate(ids)
                  selectBlocks(c.map((b) => b.id))
                },
              },
              { label: 'Move up', icon: <ArrowUp size={14} />, hint: 'Alt ⇧ ↑', onSelect: () => moveBy(menuBlock.id, -1) },
              { label: 'Move down', icon: <ArrowDown size={14} />, hint: 'Alt ⇧ ↓', onSelect: () => moveBy(menuBlock.id, 1) },
              { label: 'Insert image below', icon: <ImagePlus size={14} />, onSelect: () => {
                pendingImage.current = { afterId: menuBlock.id, replaceId: null }
                fileInput.current?.click()
              } },
              'sep',
              {
                label: 'Delete',
                icon: <Trash2 size={14} />,
                hint: 'Del',
                danger: true,
                onSelect: () => {
                  const ids = selectedRef.current.size ? selectedIds() : [menuBlock.id]
                  setSelected(new Set())
                  removeBlocks(ids, 'prev')
                },
              },
            ]}
          />
        </Popover>
      )}

      {iconPicker && (
        <EmojiPicker
          x={iconPicker.x}
          y={iconPicker.y}
          allowRemove={!iconPicker.blockId}
          onClose={() => setIconPicker(null)}
          onPick={(em) => {
            if (iconPicker.blockId) {
              const b = get(iconPicker.blockId)
              if (b) {
                checkpoint()
                replace(b.id, { props: { ...b.props, icon: em || '💡' } })
              }
            } else updatePage(pageId, { icon: em })
          }}
        />
      )}

      {band && (
        <div
          className="select-band"
          style={{
            left: Math.min(band.x0, band.x1),
            top: Math.min(band.y0, band.y1),
            width: Math.abs(band.x1 - band.x0),
            height: Math.abs(band.y1 - band.y0),
          }}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) insertImages(files, pendingImage.current.afterId, pendingImage.current.replaceId)
        }}
      />
    </div>
  )
}
