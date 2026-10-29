import { keyBetween } from '../lib/fractional'
import { registerBuiltinWidgets } from '../widgets/builtin'
import { refreshModules } from '../modules/api'
import { uid } from '../lib/id'
import { coreClient, db, initStorage, metaOf } from '../lib/storage'
import { acquirePage, releasePage, type PageSync } from '../lib/core/page-sync'
import type { Page } from '../lib/types'
import { seed } from '../lib/seed'
import { describeImport, importNimbus, nimbusDefaultPath } from '../lib/nimbus-import'
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

// ---------- page metadata writes ----------

/** Pages with a metadata write that hasn't reached the core yet; refreshes keep our copy. */
const dirty = new Map<string, number>()

function track(ids: string[], write: () => Promise<void>) {
  ids.forEach((id) => dirty.set(id, (dirty.get(id) ?? 0) + 1))
  return enqueue(write).finally(() =>
    ids.forEach((id) => {
      const n = (dirty.get(id) ?? 1) - 1
      if (n > 0) dirty.set(id, n)
      else dirty.delete(id)
    }),
  )
}

function putPage(p: Page) {
  setState((s) => ({ pages: { ...s.pages, [p.id]: p } }))
  return track([p.id], () => db().updatePage(p.id, metaOf(p)))
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined

/** Re-read the page list from the index after the core reports a change. */
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    const list = await db().listPages()
    setState((s) => {
      const pages: Record<string, Page> = {}
      list.forEach((p) => (pages[p.id] = p))
      dirty.forEach((_, id) => {
        if (s.pages[id]) pages[id] = s.pages[id]
        else delete pages[id]
      })
      return { pages, indexVersion: s.indexVersion + 1 }
    })
  }, 150)
}

// ---------- page content ----------

function trackSave(p: Promise<void>) {
  void enqueue(() => p)
}

/** Pages whose `createPage` write is still on its way to the core. */
const creating = new Map<string, Promise<void>>()

/** Open a page's Y.Doc (shared with any editor showing it). Call `releasePage` when done. */
export function syncPage(pageId: string): PageSync {
  return acquirePage(pageId, coreClient(), trackSave, creating.get(pageId))
}

async function withPage<T>(pageId: string, fn: (sync: PageSync) => Promise<T> | T): Promise<T> {
  const sync = syncPage(pageId)
  try {
    await sync.ready
    return await fn(sync)
  } finally {
    releasePage(pageId)
  }
}

export { releasePage, withPage }

// ---------- init ----------

let initPromise: Promise<void> | null = null

export function init() {
  if (!initPromise) initPromise = doInit()
  return initPromise
}

async function doInit() {
  const storage = await initStorage()
  coreClient().onEvent(() => scheduleRefresh())
  void registerBuiltinWidgets().catch((e) => console.error('widgets:', e))
  void refreshModules().catch((e) => console.error('modules:', e))
  let pages = await storage.listPages()
  // First run: bring over notes from the old Nimbus app if they're there, else sample pages.
  const nimbus = pages.length === 0 ? await nimbusDefaultPath().catch(() => null) : null
  if (nimbus) {
    const result = await importNimbus(nimbus)
    pages = await storage.listPages()
    setTimeout(() => toast(describeImport(result)), 300)
  }
  if (pages.length === 0) {
    const opened: string[] = []
    await seed(storage, async (id) => {
      opened.push(id)
      const sync = syncPage(id)
      await sync.ready
      return sync
    })
    opened.forEach(releasePage)
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

export async function createPage(
  opts: { parentId?: string | null; title?: string; icon?: string; open?: 'replace' | 'tab' | false; kind?: 'page' | 'database' } = {},
) {
  const parentId = opts.parentId ?? null
  const siblings = childrenOf(parentId, { archived: true })
  const now = Date.now()
  const page: Page = {
    id: uid(),
    kind: opts.kind ?? 'page',
    databaseId: null,
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
  const write = track([page.id], () => db().createPage(page))
  creating.set(page.id, write)
  void write.finally(() => creating.delete(page.id))
  if (opts.open !== false) openPage(page.id, opts.open ?? 'tab')
  await write
  return page
}

const titleTimers = new Map<string, ReturnType<typeof setTimeout>>()

function release(id: string) {
  const n = (dirty.get(id) ?? 1) - 1
  if (n > 0) dirty.set(id, n)
  else dirty.delete(id)
}

export function updatePage(id: string, patch: Partial<Page>, debounce = 0) {
  const p = getState().pages[id]
  if (!p) return
  const next = { ...p, ...patch, updatedAt: Date.now() }
  setState((s) => ({ pages: { ...s.pages, [id]: next } }))
  const prev = titleTimers.get(id)
  if (prev) {
    clearTimeout(prev)
    titleTimers.delete(id)
    release(id)
  }
  if (debounce) {
    dirty.set(id, (dirty.get(id) ?? 0) + 1) // keep the local title while typing
    titleTimers.set(
      id,
      setTimeout(() => {
        titleTimers.delete(id)
        release(id)
        const cur = getState().pages[id]
        if (cur) track([id], () => db().updatePage(id, metaOf(cur)))
      }, debounce),
    )
  } else {
    track([id], () => db().updatePage(id, metaOf(next)))
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
  await track(list, () => db().deletePages(list))
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
  // All notes of the original, in order, become the copy's first note (with new block ids).
  const content = await withPage(id, (s) => s.notesJSON().flatMap((n) => n.content ?? []))
  const copy = await createPage({ parentId: src.parentId, title: (src.title || 'Untitled') + ' (copy)', icon: src.icon, open: false })
  await withPage(copy.id, (s) => {
    s.setContent({ type: 'doc', content: stripIds(content) })
    return s.flush()
  })
  // place right after the original
  const sibs = childrenOf(src.parentId, { archived: true }).filter((p) => p.id !== copy.id)
  const i = sibs.findIndex((p) => p.id === id)
  putPage({ ...getState().pages[copy.id], key: keyBetween(src.key, sibs[i + 1]?.key ?? null) })
  openPage(copy.id, 'tab')
}

function stripIds<T extends { attrs?: Record<string, unknown>; content?: T[] }>(nodes: T[]): T[] {
  return nodes.map((n) => ({
    ...n,
    ...(n.attrs && 'id' in n.attrs ? { attrs: { ...n.attrs, id: null } } : {}),
    ...(n.content ? { content: stripIds(n.content) } : {}),
  }))
}

/** Create a page with a given title (used by [[link]] menu and quick find). */
export function createPageNamed(title: string, open: 'replace' | 'tab' | false = false) {
  return createPage({ title, open })
}
