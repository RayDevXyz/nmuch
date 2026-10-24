import { keyBetween } from '../lib/fractional'
import { toWrite } from '../lib/blocks'
import { uid } from '../lib/id'
import { db, initStorage } from '../lib/storage'
import type { Block, Page } from '../lib/types'
import { seed } from '../lib/seed'
import { getState, setState, toast, type View } from './store'

// ---------- write queue ----------

let chain: Promise<void> = Promise.resolve()
let pending = 0

export function enqueue(task: () => Promise<void>): Promise<void> {
  pending++
  setState({ save: 'saving' })
  chain = chain
    .then(task)
    .then(() => {
      pending--
      if (pending === 0) setState({ save: 'saved', saveError: null })
    })
    .catch((e) => {
      pending--
      console.error('save failed', e)
      setState({ save: 'error', saveError: String(e) })
    })
  return chain
}

export function flushWrites(): Promise<void> {
  return chain
}

// ---------- page helpers ----------

export const isLive = (p: Page | undefined) => !!p && p.trashedAt == null

export function childrenOf(parentId: string | null, opts: { archived?: boolean } = {}): Page[] {
  const { pages } = getState()
  return Object.values(pages)
    .filter((p) => p.parentId === parentId && p.trashedAt == null && (opts.archived || !p.archived))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function descendants(id: string, all = false): string[] {
  const { pages } = getState()
  const out: string[] = []
  const walk = (pid: string) => {
    Object.values(pages).forEach((p) => {
      if (p.parentId === pid && (all || p.trashedAt == null)) {
        out.push(p.id)
        walk(p.id)
      }
    })
  }
  walk(id)
  return out
}

export function ancestors(id: string): Page[] {
  const { pages } = getState()
  const out: Page[] = []
  let cur = pages[id]
  const seen = new Set<string>()
  while (cur && cur.parentId && pages[cur.parentId] && !seen.has(cur.parentId)) {
    seen.add(cur.parentId)
    cur = pages[cur.parentId]
    out.unshift(cur)
  }
  return out
}

export function titleOf(id: string): string {
  const p = getState().pages[id]
  return p ? p.title || 'Untitled' : 'Missing page'
}

function putPage(p: Page) {
  setState((s) => ({ pages: { ...s.pages, [p.id]: p } }))
  return enqueue(() => db().upsertPage(p))
}

// ---------- blocks ----------

export function saveBlocks(pageId: string, blocks: Block[], deletes: string[]) {
  const now = Date.now()
  const writes = blocks.map(toWrite)
  setState((s) => (s.pages[pageId] ? { pages: { ...s.pages, [pageId]: { ...s.pages[pageId], updatedAt: now } } } : {}))
  return enqueue(async () => {
    await db().saveBlocks(pageId, writes, deletes, now)
    setState((s) => ({ indexVersion: s.indexVersion + 1 }))
  })
}

// ---------- init ----------

let initPromise: Promise<void> | null = null

export function init() {
  if (!initPromise) initPromise = doInit()
  return initPromise
}

async function doInit() {
  const storage = await initStorage()
  let pages = await storage.listPages()
  if (pages.length === 0) {
    await seed(storage)
    pages = await storage.listPages()
  }
  const map: Record<string, Page> = {}
  pages.forEach((p) => (map[p.id] = p))
  const s = getState()
  const tabs = s.tabs.filter((id) => isLive(map[id]))
  let activeId = s.activeId && tabs.includes(s.activeId) ? s.activeId : tabs[0] ?? null
  if (!activeId) {
    const first = pages.filter((p) => p.parentId === null && p.trashedAt == null && !p.archived).sort((a, b) => (a.key < b.key ? -1 : 1))[0]
    if (first) {
      activeId = first.id
      tabs.push(first.id)
    }
  }
  setState({ ready: true, storageKind: storage.kind, pages: map, tabs, activeId })
}

// ---------- navigation ----------

export function setView(view: View) {
  setState({ view, sidebarOpen: true })
}

export function openPage(id: string, mode: 'replace' | 'tab' = 'replace', reveal?: string) {
  const s = getState()
  if (!s.pages[id]) return
  let tabs = s.tabs
  if (!tabs.includes(id)) {
    const at = s.activeId ? tabs.indexOf(s.activeId) : -1
    if (mode === 'tab' || at < 0) tabs = [...tabs.slice(0, at + 1), id, ...tabs.slice(at + 1)]
    else tabs = tabs.map((t, i) => (i === at ? id : t))
  }
  const expanded = { ...s.expanded }
  ancestors(id).forEach((a) => (expanded[a.id] = true))
  setState({ tabs, activeId: id, expanded, reveal: reveal ? { pageId: id, blockId: reveal } : null })
}

export function closeTab(id: string) {
  const s = getState()
  const i = s.tabs.indexOf(id)
  if (i < 0) return
  const tabs = s.tabs.filter((t) => t !== id)
  const activeId = s.activeId === id ? tabs[Math.min(i, tabs.length - 1)] ?? null : s.activeId
  setState({ tabs, activeId })
}

export function toggleExpanded(id: string, value?: boolean) {
  setState((s) => ({ expanded: { ...s.expanded, [id]: value ?? !s.expanded[id] } }))
}

// ---------- page mutations ----------

export async function createPage(opts: { parentId?: string | null; title?: string; icon?: string; open?: 'replace' | 'tab' | false } = {}) {
  const parentId = opts.parentId ?? null
  const siblings = childrenOf(parentId, { archived: true })
  const now = Date.now()
  const page: Page = {
    id: uid(),
    parentId,
    title: opts.title ?? '',
    icon: opts.icon ?? '',
    key: keyBetween(siblings[siblings.length - 1]?.key ?? null, null),
    favorite: false,
    archived: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  setState((s) => ({ pages: { ...s.pages, [page.id]: page }, expanded: parentId ? { ...s.expanded, [parentId]: true } : s.expanded }))
  const write = enqueue(() => db().upsertPage(page))
  if (opts.open !== false) openPage(page.id, opts.open ?? 'tab')
  await write
  return page
}

const titleTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function updatePage(id: string, patch: Partial<Page>, debounce = 0) {
  const p = getState().pages[id]
  if (!p) return
  const next = { ...p, ...patch, updatedAt: Date.now() }
  setState((s) => ({ pages: { ...s.pages, [id]: next } }))
  clearTimeout(titleTimers.get(id))
  if (debounce) {
    titleTimers.set(
      id,
      setTimeout(() => {
        const cur = getState().pages[id]
        if (cur) enqueue(() => db().upsertPage(cur))
      }, debounce),
    )
  } else {
    enqueue(() => db().upsertPage(next))
  }
}

export function toggleFavorite(id: string) {
  const p = getState().pages[id]
  if (p) updatePage(id, { favorite: !p.favorite })
}

export function setArchived(id: string, archived: boolean) {
  updatePage(id, { archived })
  toast(archived ? 'Moved to archive' : 'Restored from archive')
}

export function trashPage(id: string) {
  const now = Date.now()
  const ids = [id, ...descendants(id)]
  const s = getState()
  ids.forEach((pid) => {
    const p = s.pages[pid]
    if (p) putPage({ ...p, trashedAt: now })
  })
  const tabs = getState().tabs
  ids.forEach((pid) => tabs.includes(pid) && closeTab(pid))
  toast(ids.length > 1 ? `Moved ${ids.length} pages to trash` : 'Moved to trash')
}

export function restorePage(id: string) {
  const s = getState()
  const p = s.pages[id]
  if (!p || p.trashedAt == null) return
  const stamp = p.trashedAt
  const parent = p.parentId ? s.pages[p.parentId] : undefined
  const parentId = parent && parent.trashedAt == null ? p.parentId : null
  putPage({ ...p, trashedAt: null, parentId })
  descendants(id, true).forEach((d) => {
    const dp = getState().pages[d]
    if (dp && dp.trashedAt === stamp) putPage({ ...dp, trashedAt: null })
  })
  toast('Restored')
}

export async function deleteForever(ids: string[]) {
  const all = new Set<string>()
  ids.forEach((id) => {
    all.add(id)
    descendants(id, true).forEach((d) => all.add(d))
  })
  const list = [...all]
  setState((s) => {
    const pages = { ...s.pages }
    list.forEach((id) => delete pages[id])
    return { pages }
  })
  list.forEach((id) => getState().tabs.includes(id) && closeTab(id))
  await enqueue(() => db().deletePages(list))
  setState((s) => ({ indexVersion: s.indexVersion + 1 }))
}

export function emptyTrash() {
  const ids = Object.values(getState().pages)
    .filter((p) => p.trashedAt != null)
    .map((p) => p.id)
  if (ids.length) deleteForever(ids).then(() => toast('Trash emptied'))
}

export function movePage(id: string, targetId: string | null, pos: 'before' | 'after' | 'inside') {
  const s = getState()
  const page = s.pages[id]
  if (!page || id === targetId) return
  if (targetId && descendants(id, true).includes(targetId)) return
  let parentId: string | null
  let key: string
  if (pos === 'inside' || targetId === null) {
    parentId = targetId
    const kids = childrenOf(parentId, { archived: true }).filter((p) => p.id !== id)
    key = keyBetween(kids[kids.length - 1]?.key ?? null, null)
  } else {
    const target = s.pages[targetId]
    if (!target) return
    parentId = target.parentId
    const sibs = childrenOf(parentId, { archived: true }).filter((p) => p.id !== id)
    const i = sibs.findIndex((p) => p.id === targetId)
    const before = pos === 'before' ? sibs[i - 1] : target
    const after = pos === 'before' ? target : sibs[i + 1]
    key = keyBetween(before?.key ?? null, after?.key ?? null)
  }
  putPage({ ...page, parentId, key, updatedAt: Date.now() })
  if (parentId) toggleExpanded(parentId, true)
}

export async function duplicatePage(id: string) {
  const src = getState().pages[id]
  if (!src) return
  const blocks = await db().getBlocks(id)
  const copy = await createPage({ parentId: src.parentId, title: (src.title || 'Untitled') + ' (copy)', icon: src.icon, open: false })
  const fresh = blocks.map((b) => ({ ...b, id: uid(), pageId: copy.id }))
  await saveBlocks(copy.id, fresh, [])
  // place right after the original
  const sibs = childrenOf(src.parentId, { archived: true }).filter((p) => p.id !== copy.id)
  const i = sibs.findIndex((p) => p.id === id)
  putPage({ ...getState().pages[copy.id], key: keyBetween(src.key, sibs[i + 1]?.key ?? null) })
  openPage(copy.id, 'tab')
}

/** Create a page with a given title (used by [[link]] menu and quick find). */
export function createPageNamed(title: string, open: 'replace' | 'tab' | false = false) {
  return createPage({ title, open })
}
