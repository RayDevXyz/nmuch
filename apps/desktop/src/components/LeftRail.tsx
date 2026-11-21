import { useMemo } from 'react'
import { Archive, BookmarkCheck, CircleHelp, Clock3, Home, PanelLeft, Search, Star, Tag, Trash2 } from 'lucide-react'
import { setView } from '../state/actions'
import { setState, useApp, type View } from '../state/store'
import { IconButton } from './TopBar'

export function LeftRail() {
  const view = useApp((s) => s.view)
  const open = useApp((s) => s.sidebarOpen)
  const pages = useApp((s) => s.pages)
  const trashCount = useMemo(() => Object.values(pages).filter((p) => p.trashedAt != null).length, [pages])
  const favCount = useMemo(() => Object.values(pages).filter((p) => p.favorite && p.trashedAt == null).length, [pages])
  const item = (v: View, icon: React.ReactNode, label: string, badge?: number) => (
    <button className={`nav-item ${view === v && open ? 'selected' : ''}`} title={label} aria-label={label} onClick={() => (view === v && open ? setState({ sidebarOpen: false }) : setView(v))}>
      {icon}
      <span>{label}</span>
      {!!badge && <em>{badge}</em>}
    </button>
  )
  return (
    <aside className={`left-rail ${open ? '' : 'collapsed'}`}>
      <div className="rail-top">
        <IconButton label="Toggle sidebar (Ctrl \)" active={open} onClick={() => setState({ sidebarOpen: !open })}>
          <PanelLeft />
        </IconButton>
      </div>
      <nav className="rail-nav" aria-label="Primary navigation">
        {item('home', <Home />, 'Documents')}
        <button className="nav-item" title="Quick find" aria-label="Quick find" onClick={() => setState({ quickFind: true })}>
          <Search />
          <span>Quick find</span>
        </button>
        {item('recent', <Clock3 />, 'Recent')}
        {item('favorites', <Star />, 'Favorites', favCount)}
        <div className="nav-divider" />
        {item('tags', <Tag />, 'Tags')}
        {item('archive', <Archive />, 'Archive')}
        {item('trash', <Trash2 />, 'Trash', trashCount)}
        <div className="nav-divider" />
        {item('burrow', <BookmarkCheck />, 'Burrow')}
      </nav>
      <div className="rail-footer">
        <button className="nav-item" title="Help & shortcuts" aria-label="Help & shortcuts" onClick={() => setState({ help: true })}>
          <CircleHelp />
          <span>Help & shortcuts</span>
        </button>
      </div>
    </aside>
  )
}
