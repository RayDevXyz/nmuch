import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import {
  Archive,
  Bold,
  BookmarkCheck,
  Brackets,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Heading2,
  Home,
  Inbox,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListTodo,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  Redo2,
  Search,
  Settings,
  Slash,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Tag,
  FileStack,
  Trash2,
  Undo2,
  X, FolderKanban } from 'lucide-react'
import { ancestors, closeTab, createPage, openPage, setView, toggleFavorite } from '../state/actions'
import { getState, setState, useApp, type View } from '../state/store'
import type { Page } from '../lib/types'
import { Popover } from '../components/Popover'
import { SettingsPanel } from '../components/TopBar'
import { AccountDialog } from '../auth/Account'
import { hostedUser } from '../state/hosted'
import { inboxPage } from './share'
import { useInstall } from './pwa'

/* ------------------------------------------------------------------ */
/* What has the keyboard: a note editor, another text field, or nothing */

type Focus = { kind: 'editor'; editor: TiptapEditor } | { kind: 'text' } | null

function readFocus(): Focus {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return null
  const pm = el.closest('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (pm?.editor && pm.editor.isEditable) return { kind: 'editor', editor: pm.editor }
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|range|color)$/.test((el as HTMLInputElement).type)))
    return { kind: 'text' }
  return null
}

export function useFocus(): Focus {
  const [focus, setFocus] = useState<Focus>(readFocus)
  useEffect(() => {
    let t = 0
    const update = () => {
      clearTimeout(t)
      // focusout fires before the next element takes focus; look once things settle.
      t = window.setTimeout(() => setFocus(readFocus()), 0)
    }
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      clearTimeout(t)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return focus
}

/** How far the on-screen keyboard covers the layout (iOS; Android resizes the page instead). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    on()
    return () => {
      vv.removeEventListener('resize', on)
      vv.removeEventListener('scroll', on)
    }
  }, [])
  return inset
}

/* ------------------------------------------------------------------ */
/* The page header: one compact bar instead of the top bar + tabs bar */

/** Pages visited on the phone, for Back (the page before, not just the page above). */
const visited: string[] = []
let goingBack = false
function remember(prev: string | undefined, next: string | undefined) {
  if (goingBack) return void (goingBack = false)
  if (prev && prev !== next && getState().pages[prev]) {
    visited.push(prev)
    if (visited.length > 50) visited.shift()
  }
}
/** Back: the page you came from; with none, the page above this one. */
function goBack(page: Page | undefined, parent: Page | undefined) {
  while (visited.length) {
    const id = visited.pop()!
    const p = getState().pages[id]
    if (p && p.trashedAt == null && id !== page?.id) {
      goingBack = true
      return openPage(id, 'replace')
    }
  }
  if (parent) openPage(parent.id, 'replace')
}

export function MobileHeader({ page, onMore }: { page?: Page; onMore: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  useApp((s) => s.pages) // re-render on parent renames
  const trail = page ? ancestors(page.id) : []
  const parent = trail[trail.length - 1]
  const last = useRef<string | undefined>(page?.id)
  useEffect(() => {
    remember(last.current, page?.id)
    last.current = page?.id
  }, [page?.id])
  const canBack = visited.length > 0 || !!parent
  return (
    <>
    <header className="m-header">
      {page && canBack ? (
        <button className="m-icon" aria-label="Back" title="Back" onClick={() => goBack(page, parent)}>
          <ChevronLeft />
        </button>
      ) : (
        <button className="m-icon" aria-label="Open sidebar" onClick={() => setState((s) => ({ sidebarOpen: !s.sidebarOpen }))}>
          <Menu />
        </button>
      )}
      <button className="m-title" onClick={() => setState({ quickFind: true })} aria-label="Find a page">
        {page ? (
          <>
            <strong>
              {page.icon ? <span className="m-title-icon">{page.icon}</span> : <FileText size={15} />}
              <span>{page.title || 'Untitled'}</span>
            </strong>
          </>
        ) : (
          <strong>
            <Sparkles size={15} /> BrainWaves
          </strong>
        )}
      </button>
      {page && (
        <>
          <button className={`m-icon ${page.favorite ? 'on' : ''}`} aria-label={page.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(page.id)}>
            <Star className={page.favorite ? 'star-on' : ''} />
          </button>
          <button className="m-icon" aria-label="More options" onClick={onMore}>
            <MoreHorizontal />
          </button>
        </>
      )}
    </header>
    {page && trail.length > 0 && <MobileCrumbs page={page} trail={trail} />}
    </>
  )
}

/** Where the page is: tap any step (the top-level page first) to go there. */
function MobileCrumbs({ page, trail }: { page: Page; trail: Page[] }) {
  const ref = useRef<HTMLElement>(null)
  // The end of the path (the page itself) stays in view.
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [page.id, trail.length])
  return (
    <nav className="m-crumbs" aria-label="Where this page is" ref={ref}>
      <button className="m-crumb home" aria-label="Home: all pages" onClick={() => setView('home')}>
        <Home size={14} />
      </button>
      {trail.map((p) => (
        <span key={p.id} className="m-crumb-step">
          <ChevronRight size={12} aria-hidden />
          <button className="m-crumb" onClick={() => openPage(p.id, 'replace')}>
            {p.icon && <span>{p.icon}</span>}
            {p.title || 'Untitled'}
          </button>
        </span>
      ))}
      <span className="m-crumb-step">
        <ChevronRight size={12} aria-hidden />
        <span className="m-crumb current" aria-current="page">
          {page.title || 'Untitled'}
        </span>
      </span>
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* Bottom navigation (Notion-style), swapped for a formatting bar while typing */

export function MobileBottom() {
  const focus = useFocus()
  const inset = useKeyboardInset()
  if (focus?.kind === 'editor') return <KeyboardBar editor={focus.editor} inset={inset} />
  if (focus) return null // a title or a search field: the keyboard needs the room
  return <MobileNav />
}

function MobileNav() {
  const tabs = useApp((s) => s.tabs.length)
  const open = useApp((s) => s.sidebarOpen)
  const view = useApp((s) => s.view)
  const [switcher, setSwitcher] = useState(false)
  return (
    <>
      <nav className="m-nav" aria-label="Navigation">
        <button className={open && view === 'home' ? 'on' : ''} onClick={() => (open && view === 'home' ? setState({ sidebarOpen: false }) : setView('home'))}>
          <Home />
          <span>Pages</span>
        </button>
        <button onClick={() => setState({ quickFind: true, sidebarOpen: false })}>
          <Search />
          <span>Search</span>
        </button>
        <button className="m-new" aria-label="New page" onClick={() => void createPage()}>
          <Plus />
        </button>
        <button onClick={() => void inboxPage().then((id) => openPage(id, 'replace'))}>
          <Inbox />
          <span>Inbox</span>
        </button>
        <button onClick={() => setSwitcher(true)}>
          <span className="m-tabcount">{tabs}</span>
          <span>Tabs</span>
        </button>
      </nav>
      {switcher && <TabSwitcher onClose={() => setSwitcher(false)} />}
    </>
  )
}

function TabSwitcher({ onClose }: { onClose: () => void }) {
  const tabs = useApp((s) => s.tabs)
  const pages = useApp((s) => s.pages)
  const activeId = useApp((s) => s.activeId)
  return (
    <Popover x={0} y={0} onClose={onClose} className="m-tabs">
      <div className="m-sheet-title">
        <span>Open tabs</span>
        <button
          className="m-sheet-action"
          onClick={() => {
            onClose()
            void createPage({ open: 'tab' })
          }}
        >
          <Plus size={15} /> New tab
        </button>
      </div>
      {!tabs.length && <p className="m-sheet-empty">No tabs open.</p>}
      {tabs.map((id) => {
        const p = pages[id]
        if (!p) return null
        return (
          <div key={id} className={`m-tab ${id === activeId ? 'on' : ''}`}>
            <button
              className="m-tab-open"
              onClick={() => {
                onClose()
                setState({ activeId: id })
              }}
            >
              <span className="m-tab-icon">{p.icon || <FileText size={16} />}</span>
              <span className="m-tab-title">{p.title || 'Untitled'}</span>
            </button>
            <button className="m-tab-close" aria-label="Close tab" onClick={() => closeTab(id)}>
              <X size={16} />
            </button>
          </div>
        )
      })}
    </Popover>
  )
}

function KeyboardBar({ editor, inset }: { editor: TiptapEditor; inset: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => tick((n) => n + 1)
    editor.on('transaction', on)
    return () => void editor.off('transaction', on)
  }, [editor])
  const run = (fn: () => void) => ({
    // keep the caret (and the keyboard) where it is
    onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: fn,
  })
  const chain = () => editor.chain().focus()
  const cmds = editor.commands as unknown as Record<string, ((...a: unknown[]) => boolean) | undefined>
  const btn = (label: string, icon: ReactNode, fn: () => void, active = false) => (
    <button key={label} aria-label={label} title={label} className={active ? 'on' : ''} {...run(fn)}>
      {icon}
    </button>
  )
  const inList = editor.isActive('listItem') || editor.isActive('taskItem')
  const item = editor.isActive('taskItem') ? 'taskItem' : 'listItem'
  return (
    <div className="m-kbar" style={inset ? { transform: `translateY(-${inset}px)` } : undefined}>
      <div className="m-kbar-scroll">
        {btn('Insert block', <Slash />, () => chain().insertContent('/').run())}
        {btn('Link a page', <Brackets />, () => chain().insertContent('[[').run())}
        {btn('Bold', <Bold />, () => chain().toggleBold().run(), editor.isActive('bold'))}
        {btn('Italic', <Italic />, () => chain().toggleItalic().run(), editor.isActive('italic'))}
        {btn('Heading', <Heading2 />, () => chain().toggleHeading({ level: 2 }).run(), editor.isActive('heading'))}
        {btn('Bulleted list', <List />, () => chain().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('To-do list', <ListTodo />, () => chain().toggleTaskList().run(), editor.isActive('taskList'))}
        {inList && btn('Indent', <IndentIncrease />, () => chain().sinkListItem(item).run())}
        {inList && btn('Outdent', <IndentDecrease />, () => chain().liftListItem(item).run())}
        {cmds.undo && btn('Undo', <Undo2 />, () => cmds.undo?.())}
        {cmds.redo && btn('Redo', <Redo2 />, () => cmds.redo?.())}
      </div>
      <button className="m-kbar-done" aria-label="Hide keyboard" {...run(() => editor.commands.blur())}>
        <ChevronDown />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Top of the drawer: the workspace, search and the sidebar's views */

export function DrawerHead() {
  const view = useApp((s) => s.view)
  const theme = useApp((s) => s.theme)
  const kind = useApp((s) => s.storageKind)
  const pages = useApp((s) => s.pages)
  const trash = Object.values(pages).filter((p) => p.trashedAt != null).length
  const [settings, setSettings] = useState(false)
  const [account, setAccount] = useState(false)
  const { canInstall, install } = useInstall()
  const chip = (v: View, icon: ReactNode, label: string, badge?: number) => (
    <button key={v} className={`m-chip ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
      {icon}
      <span>{label}</span>
      {!!badge && <em>{badge}</em>}
    </button>
  )
  return (
    <div className="m-drawer-head">
      <div className="m-drawer-brand">
        <span className="brand-mark" aria-hidden>
          <Sparkles size={15} />
        </span>
        <strong>BrainWaves</strong>
        <span className="m-drawer-store">
          <span className="dot" />
          {kind === 'sqlite' ? 'Local' : hostedUser() ? 'Hosted' : 'Dev'}
        </span>
        <span className="m-spacer" />
        {canInstall && (
          <button className="m-icon" aria-label="Install app" onClick={() => void install()}>
            <Smartphone />
          </button>
        )}
        <button className="m-icon" aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setState({ theme: getState().theme === 'dark' ? 'light' : 'dark' })}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>
        <button className="m-icon" aria-label="Settings" onClick={() => setSettings(true)}>
          <Settings />
        </button>
        <button className="m-icon" aria-label="Close sidebar" onClick={() => setState({ sidebarOpen: false })}>
          <X />
        </button>
      </div>
      <button className="m-search" onClick={() => setState({ quickFind: true, sidebarOpen: false })}>
        <Search size={16} />
        <span>Search pages</span>
      </button>
      <div className="m-chips">
        {chip('home', <FileText />, 'Pages')}
        {chip('recent', <Clock3 />, 'Recent')}
        {chip('favorites', <Star />, 'Favorites')}
        {chip('tags', <Tag />, 'Tags')}
        {chip('templates', <FileStack />, 'Templates')}
        {chip('para', <FolderKanban />, 'PARA')}
        {chip('burrow', <BookmarkCheck />, 'Burrow')}
        {chip('archive', <Archive />, 'Archive')}
        {chip('trash', <Trash2 />, 'Trash', trash)}
      </div>
      {settings && <SettingsPanel x={0} y={0} onClose={() => setSettings(false)} onAccount={() => setAccount(true)} />}
      {account && hostedUser() && <AccountDialog user={hostedUser()!} onClose={() => setAccount(false)} />}
    </div>
  )
}
