import { useMemo, useState } from 'react'
import { Archive, BookmarkCheck, FileStack, FolderKanban, Home, Inbox, PanelLeft, Settings, Sparkles, Star, Tag, Trash2 } from 'lucide-react'
import { openPage, setView } from '../state/actions'
import { setState, toast, useApp, type View } from '../state/store'
import { inboxPage } from '../mobile/share'
import { AppMenu, SettingsHost } from './TopBar'

/**
 * The left rail, the full height of the window: the app icon (its menu), the sidebar toggle,
 * the places (Home, Inbox, Tags, Starred, Templates), the plugins (PARA, Burrow), Archived and
 * Trashed, and Settings at the bottom.
 */
export function LeftRail() {
  const view = useApp((s) => s.view)
  const open = useApp((s) => s.sidebarOpen)
  const pages = useApp((s) => s.pages)
  const activeId = useApp((s) => s.activeId)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [settings, setSettings] = useState<{ x: number; y: number; anchorTop?: number } | null>(null)
  const trashCount = useMemo(() => Object.values(pages).filter((p) => p.trashedAt != null).length, [pages])
  const favCount = useMemo(() => Object.values(pages).filter((p) => p.favorite && p.trashedAt == null).length, [pages])
  const inboxId = useMemo(() => Object.values(pages).find((p) => !p.parentId && !p.databaseId && p.trashedAt == null && p.title === 'Inbox')?.id, [pages])

  const item = (v: View, icon: React.ReactNode, label: string, badge?: number) => (
    <button className={`nav-item ${view === v && open ? 'selected' : ''}`} title={label} aria-label={label} onClick={() => (view === v && open ? setState({ sidebarOpen: false }) : setView(v))}>
      {icon}
      <span>{label}</span>
      {!!badge && <em>{badge}</em>}
    </button>
  )
  // The app menu opens below the icon; Settings opens beside the rail, upwards from its button.
  const at = (e: React.MouseEvent<HTMLButtonElement>, below: boolean) => {
    const r = e.currentTarget.getBoundingClientRect()
    const rail = e.currentTarget.closest('.left-rail')?.getBoundingClientRect().right ?? r.right
    return below ? { x: r.left, y: r.bottom } : { x: rail + 6, y: r.bottom, anchorTop: r.bottom }
  }

  return (
    <aside className="left-rail">
      <div className="rail-top">
        <button className={`rail-brand ${menu ? 'on' : ''}`} aria-label="BrainWaves menu" title="BrainWaves" onClick={(e) => setMenu(at(e, true))}>
          <Sparkles size={16} />
        </button>
      </div>
      <nav className="rail-nav" aria-label="Primary navigation">
        <button className={`nav-item ${open ? 'selected' : ''}`} title="Toggle sidebar (Ctrl \)" aria-label="Toggle sidebar" onClick={() => setState({ sidebarOpen: !open })}>
          <PanelLeft />
          <span>Sidebar</span>
        </button>
        <div className="nav-divider" />
        {item('home', <Home />, 'Home')}
        <button
          className={`nav-item ${inboxId && activeId === inboxId ? 'selected' : ''}`}
          title="Inbox"
          aria-label="Inbox"
          onClick={() =>
            inboxPage().then(
              (id) => openPage(id, 'replace'),
              (e) => toast(`Could not open the Inbox: ${e}`),
            )
          }
        >
          <Inbox />
          <span>Inbox</span>
        </button>
        {item('tags', <Tag />, 'Tags')}
        {item('favorites', <Star />, 'Starred', favCount)}
        {item('templates', <FileStack />, 'Templates')}
        <div className="nav-divider" />
        {item('para', <FolderKanban />, 'PARA')}
        {item('burrow', <BookmarkCheck />, 'Burrow')}
        <div className="nav-divider" />
        {item('archive', <Archive />, 'Archived')}
        {item('trash', <Trash2 />, 'Trashed', trashCount)}
      </nav>
      <div className="rail-footer">
        <button className={`nav-item ${settings ? 'selected' : ''}`} title="Settings" aria-label="Settings" onClick={(e) => setSettings(at(e, false))}>
          <Settings />
          <span>Settings</span>
        </button>
      </div>
      {menu && <AppMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {settings && <SettingsHost at={settings} onClose={() => setSettings(null)} />}
    </aside>
  )
}
