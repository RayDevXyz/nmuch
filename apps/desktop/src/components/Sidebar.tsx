import { tabKey } from '../lib/storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FileText,
  FileStack,
  FolderOpen,
  Folder,
  Hash,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react'
import {
  createPage,
  deleteForever,
  duplicatePage,
  emptyTrash,
  movePage,
  siblingOrder,
  openPage,
  restorePage,
  setArchived,
  toggleExpanded,
  toggleFavorite,
  trashPage,
  updatePage,
} from '../state/actions'
import { setState, toast, useApp } from '../state/store'
import type { Page, TagCount } from '../lib/types'
import { db } from '../lib/storage'
import { relativeTime } from '../lib/time'
import { pageMarkdown } from '../editor/Editor'
import { IconButton } from './TopBar'
import { MenuList, Popover, type MenuEntry } from './Popover'
import { BurrowPanel } from '../burrow/Burrow'
import { BurrowTagItems } from '../burrow/Tags'
import { useNarrow } from '../mobile/narrow'
import { DrawerHead } from '../mobile/MobileChrome'
import { ensureTemplatesFolder, templatesFolder } from '../templates/apply'
import { openTemplateDialog } from '../templates/TemplateDialog'
import { ParaView } from '../para/ParaView'
import { ResizeHandle } from './ResizeHandle'

const byKey = siblingOrder

function PageIcon({ page, size = 14 }: { page: Page; size?: number }) {
  return page.icon ? <span className="doc-emoji">{page.icon}</span> : <FileText size={size} className="doc-fallback" />
}

function pageMenu(page: Page, startRename?: () => void): (MenuEntry | 'sep')[] {
  const live = page.trashedAt == null
  if (!live)
    return [
      { label: 'Restore', icon: <RotateCcw size={14} />, onSelect: () => restorePage(page.id) },
      { label: 'Delete forever', icon: <Trash2 size={14} />, danger: true, onSelect: () => deleteForever([page.id]) },
    ]
  return [
    { label: 'Open in new tab', icon: <ExternalLink size={14} />, onSelect: () => openPage(page.id, 'tab') },
    { label: 'Add sub-page', icon: <Plus size={14} />, onSelect: () => createPage({ parentId: page.id }) },
    ...(startRename ? [{ label: 'Rename', icon: <Pencil size={14} />, onSelect: startRename }] : []),
    {
      label: page.favorite ? 'Remove from favorites' : 'Add to favorites',
      icon: page.favorite ? <StarOff size={14} /> : <Star size={14} />,
      onSelect: () => toggleFavorite(page.id),
    },
    { label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => duplicatePage(page.id) },
    {
      label: 'Copy as Markdown',
      icon: <ClipboardCopy size={14} />,
      onSelect: async () => {
        await navigator.clipboard?.writeText(await pageMarkdown(page.id))
        toast('Copied as Markdown')
      },
    },
    'sep',
    page.archived
      ? { label: 'Unarchive', icon: <ArchiveRestore size={14} />, onSelect: () => setArchived(page.id, false) }
      : { label: 'Archive', icon: <Archive size={14} />, onSelect: () => setArchived(page.id, true) },
    { label: 'Move to trash', icon: <Trash2 size={14} />, danger: true, onSelect: () => trashPage(page.id) },
  ]
}

type DropPos = 'before' | 'after' | 'inside'
const DND = 'application/x-brainwaves-page'

function TreeNode({ page, depth, childMap }: { page: Page; depth: number; childMap: Map<string | null, Page[]> }) {
  const expanded = useApp((s) => !!s.expanded[page.id])
  const active = useApp((s) => s.activeId === page.id)
  const kids = childMap.get(page.id) ?? []
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [drop, setDrop] = useState<DropPos | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const posFor = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - r.top
    return y < r.height * 0.28 ? 'before' : y > r.height * 0.72 ? 'after' : 'inside'
  }

  return (
    <>
      <div
        className={`tree-row doc-row ${active ? 'active' : ''} ${drop ? 'drop-' + drop : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(DND, page.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DND)) return
          e.preventDefault()
          setDrop(posFor(e))
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DND)
          const pos = posFor(e)
          setDrop(null)
          if (id && id !== page.id) {
            e.preventDefault()
            movePage(id, page.id, pos)
          }
        }}
        onClick={(e) => !renaming && openPage(page.id, e.ctrlKey || e.metaKey ? 'tab' : 'replace')}
        onAuxClick={(e) => e.button === 1 && openPage(page.id, 'tab')}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <button
          className={`tree-chevron ${kids.length ? '' : 'empty'}`}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(page.id)
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <PageIcon page={page} />
        {renaming ? (
          <input
            ref={inputRef}
            className="rename-input"
            defaultValue={page.title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              updatePage(page.id, { title: e.target.value.trim() })
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="tree-title">{page.title || 'Untitled'}</span>
        )}
        {kids.length > 0 && !renaming && <small>{kids.length}</small>}
        <span className="row-actions">
          <button
            className="row-btn"
            aria-label="Page options"
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.left, y: r.bottom })
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            className="row-btn"
            aria-label="Add sub-page"
            onClick={(e) => {
              e.stopPropagation()
              createPage({ parentId: page.id, open: 'replace' })
            }}
          >
            <Plus size={14} />
          </button>
        </span>
      </div>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuList items={pageMenu(page, () => setRenaming(true))} onDone={() => setMenu(null)} />
        </Popover>
      )}
      {expanded && kids.map((k) => <TreeNode key={k.id} page={k} depth={depth + 1} childMap={childMap} />)}
      {expanded && kids.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 30 + depth * 14 }}>
          No pages inside
        </div>
      )}
    </>
  )
}

function FlatRow({ page, meta, actions }: { page: Page; meta?: string; actions?: React.ReactNode }) {
  const active = useApp((s) => s.activeId === page.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const live = page.trashedAt == null
  return (
    <>
      <div
        className={`tree-row doc-row flat ${active ? 'active' : ''} ${live ? '' : 'dead'}`}
        onClick={(e) => live && openPage(page.id, e.ctrlKey || e.metaKey ? 'tab' : 'replace')}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <PageIcon page={page} />
        <span className="tree-title">{page.title || 'Untitled'}</span>
        {meta && <small>{meta}</small>}
        {actions && <span className="row-actions always">{actions}</span>}
      </div>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuList items={pageMenu(page)} onDone={() => setMenu(null)} />
        </Popover>
      )}
    </>
  )
}

function Outline() {
  const outline = useApp((s) => s.outline)
  const current = useApp((s) => s.currentHeading)
  const activeId = useApp((s) => s.activeId)
  if (!activeId || !outline.length) return null
  return (
    <>
      <div className="sidebar-section-title">
        <span>Outline</span>
        <span className="count">{outline.length}</span>
      </div>
      <div className="outline">
        {outline.map((item) => (
          <button
            key={item.id}
            className={`outline-row lvl-${item.type} ${current === item.id ? 'current' : ''}`}
            onClick={() => setState({ reveal: { pageId: activeId, blockId: item.id } })}
          >
            <span>{item.type.toUpperCase()}</span>
            <em>{item.text || 'Untitled heading'}</em>
          </button>
        ))}
      </div>
    </>
  )
}

function HomeView({ childMap }: { childMap: Map<string | null, Page[]> }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const [rootOpen, setRootOpen] = useState(true)
  const [rootDrop, setRootDrop] = useState(false)
  const pages = useApp((s) => s.pages)
  const roots = childMap.get(null) ?? []
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return Object.values(pages)
      .filter((p) => p.trashedAt == null && (p.title || 'untitled').toLowerCase().includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [q, pages])

  return (
    <>
      <div className="sidebar-heading">
        <span>Documents</span>
        <div>
          <IconButton
            label="Filter pages"
            active={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen)
              setQ('')
            }}
          >
            <Search />
          </IconButton>
          <IconButton label={`New page (${tabKey('N')})`} onClick={() => createPage({ open: 'replace' })}>
            <Plus />
          </IconButton>
        </div>
      </div>
      {searchOpen && (
        <div className="search-box">
          <Search size={14} />
          <input autoFocus placeholder="Filter pages…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setSearchOpen(false), setQ(''))} />
          <X size={14} className="clickable" onClick={() => (setSearchOpen(false), setQ(''))} />
        </div>
      )}
      <div className="tree">
        {q.trim() ? (
          matches.length ? (
            matches.map((p) => <FlatRow key={p.id} page={p} meta={relativeTime(p.updatedAt)} />)
          ) : (
            <div className="sidebar-empty">No pages match “{q}”</div>
          )
        ) : (
          <>
            <div
              className={`tree-row folder-row ${rootDrop ? 'drop-inside' : ''}`}
              onClick={() => setRootOpen(!rootOpen)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DND)) return
                e.preventDefault()
                setRootDrop(true)
              }}
              onDragLeave={() => setRootDrop(false)}
              onDrop={(e) => {
                setRootDrop(false)
                const id = e.dataTransfer.getData(DND)
                if (id) movePage(id, null, 'inside')
              }}
            >
              {rootOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {rootOpen ? <FolderOpen size={16} className="folder-icon" /> : <Folder size={16} className="folder-icon" />}
              <span>My workspace</span>
              <span className="row-actions">
                <button
                  className="row-btn"
                  aria-label="New page"
                  onClick={(e) => {
                    e.stopPropagation()
                    createPage({ open: 'replace' })
                  }}
                >
                  <Plus size={14} />
                </button>
              </span>
            </div>
            {rootOpen && roots.map((p) => <TreeNode key={p.id} page={p} depth={0} childMap={childMap} />)}
            {rootOpen && roots.length === 0 && (
              <button className="sidebar-empty add" onClick={() => createPage({ open: 'replace' })}>
                <Plus size={13} /> Create your first page
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}

/**
 * Templates, out of the way of the Documents tree: the pages inside the Templates page, as a
 * tree of their own (a template's sub-pages are part of it). Open one to edit it.
 */
function TemplatesView({ childMap }: { childMap: Map<string | null, Page[]> }) {
  const pages = useApp((s) => s.pages)
  const folder = useMemo(() => templatesFolder(), [pages])
  const list = folder ? (childMap.get(folder.id) ?? []) : []
  const newTemplate = async () => {
    const f = await ensureTemplatesFolder()
    createPage({ parentId: f.id, open: 'replace' })
  }
  return (
    <>
      <div className="sidebar-heading">
        <span>Templates</span>
        <div>
          <IconButton label="New template" onClick={() => void newTemplate()}>
            <Plus />
          </IconButton>
        </div>
      </div>
      <div className="tpl-side">
        {list.length === 0 ? (
          <p className="tpl-side-hint">No templates yet. Make one with +, or choose <b>Save as template</b> in a page's ⋯ menu.</p>
        ) : (
          <div className="tree">
            {list.map((p) => (
              <TreeNode key={p.id} page={p} depth={0} childMap={childMap} />
            ))}
          </div>
        )}
        <button className="tpl-side-use" onClick={() => openTemplateDialog({ parentId: null })}>
          <FileStack size={14} /> <span>New page from a template</span> <kbd>{tabKey('Shift N')}</kbd>
        </button>
        {folder && (
          <button className="tpl-side-link" onClick={() => openPage(folder.id, 'replace')}>
            How templates work
          </button>
        )}
      </div>
    </>
  )
}

function ListView({ title, pages, empty, meta, actions, footer }: { title: string; pages: Page[]; empty: string; meta?: (p: Page) => string; actions?: (p: Page) => React.ReactNode; footer?: React.ReactNode }) {
  return (
    <>
      <div className="sidebar-heading">
        <span>{title}</span>
        <span className="count">{pages.length}</span>
      </div>
      <div className="tree">
        {pages.length ? pages.map((p) => <FlatRow key={p.id} page={p} meta={meta?.(p)} actions={actions?.(p)} />) : <div className="sidebar-empty">{empty}</div>}
      </div>
      {footer}
    </>
  )
}

function TagsView() {
  const version = useApp((s) => s.indexVersion)
  const pages = useApp((s) => s.pages)
  const tag = useApp((s) => s.tag)
  const [tags, setTags] = useState<TagCount[]>([])
  const [tagPages, setTagPages] = useState<string[]>([])
  useEffect(() => {
    db().tags().then(setTags)
  }, [version, pages])
  useEffect(() => {
    if (tag) db().pagesWithTag(tag).then(setTagPages)
  }, [tag, version])
  const list = tagPages.map((id) => pages[id]).filter((p): p is Page => !!p && p.trashedAt == null)
  return (
    <>
      <div className="sidebar-heading">
        <span>Tags</span>
        <span className="count">{tags.length}</span>
      </div>
      <div className="tag-cloud">
        {tags.map((t) => (
          <button key={t.tag} className={`tag-chip ${tag === t.tag ? 'on' : ''}`} onClick={() => setState({ tag: tag === t.tag ? null : t.tag })}>
            <Hash size={11} />
            {t.tag}
            <small>{t.count}</small>
          </button>
        ))}
        {!tags.length && <div className="sidebar-empty">Type #something in any block to tag it.</div>}
      </div>
      {tag && (
        <>
          <div className="sidebar-section-title">
            <span>#{tag}</span>
            <span className="count">{list.length}</span>
          </div>
          <div className="tree">
            {list.map((p) => (
              <FlatRow key={p.id} page={p} meta={relativeTime(p.updatedAt)} />
            ))}
          </div>
          <BurrowTagItems tag={tag} />
        </>
      )}
    </>
  )
}

export function Sidebar() {
  const view = useApp((s) => s.view)
  const pages = useApp((s) => s.pages)
  const childMap = useMemo(() => {
    const m = new Map<string | null, Page[]>()
    // The Templates page has its own place (the Templates view), not the Documents tree.
    const templates = templatesFolder()?.id
    Object.values(pages).forEach((p) => {
      // Database rows are listed inside their database, not in the tree.
      if (p.trashedAt != null || p.archived || p.databaseId || p.id === templates) return
      const parent = p.parentId && pages[p.parentId] && pages[p.parentId].trashedAt == null ? p.parentId : null
      if (!m.has(parent)) m.set(parent, [])
      m.get(parent)!.push(p)
    })
    m.forEach((l) => l.sort(byKey))
    return m
  }, [pages])
  const all = Object.values(pages)
  const narrow = useNarrow()
  const sidebarWidth = useApp((s) => s.sidebarWidth)

  let body: React.ReactNode
  if (view === 'recent') {
    body = (
      <ListView
        title="Recent"
        pages={all
          .filter((p) => p.trashedAt == null)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 40)}
        empty="Nothing yet"
        meta={(p) => relativeTime(p.updatedAt)}
      />
    )
  } else if (view === 'favorites') {
    body = (
      <ListView
        title="Favorites"
        pages={all.filter((p) => p.favorite && p.trashedAt == null).sort(byKey)}
        empty="Star a page to pin it here."
        actions={(p) => (
          <button className="row-btn" aria-label="Remove from favorites" onClick={(e) => (e.stopPropagation(), toggleFavorite(p.id))}>
            <StarOff size={13} />
          </button>
        )}
      />
    )
  } else if (view === 'archive') {
    body = (
      <ListView
        title="Archive"
        pages={all.filter((p) => p.archived && p.trashedAt == null).sort((a, b) => b.updatedAt - a.updatedAt)}
        empty="Archived pages are hidden from the tree but stay searchable."
        meta={(p) => relativeTime(p.updatedAt)}
        actions={(p) => (
          <button className="row-btn" aria-label="Unarchive" title="Unarchive" onClick={(e) => (e.stopPropagation(), setArchived(p.id, false))}>
            <ArchiveRestore size={13} />
          </button>
        )}
      />
    )
  } else if (view === 'trash') {
    const trashed = all
      .filter((p) => p.trashedAt != null && !(p.parentId && pages[p.parentId]?.trashedAt === p.trashedAt))
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
    body = (
      <ListView
        title="Trash"
        pages={trashed}
        empty="Trash is empty."
        meta={(p) => relativeTime(p.trashedAt ?? 0)}
        actions={(p) => (
          <>
            <button className="row-btn" aria-label="Restore" title="Restore" onClick={(e) => (e.stopPropagation(), restorePage(p.id))}>
              <RotateCcw size={13} />
            </button>
            <button className="row-btn danger" aria-label="Delete forever" title="Delete forever" onClick={(e) => (e.stopPropagation(), deleteForever([p.id]))}>
              <Trash2 size={13} />
            </button>
          </>
        )}
        footer={
          trashed.length > 0 && (
            <button className="empty-trash" onClick={emptyTrash}>
              <Trash2 size={13} /> Empty trash
            </button>
          )
        }
      />
    )
  } else if (view === 'tags') {
    body = <TagsView />
  } else if (view === 'templates') {
    body = <TemplatesView childMap={childMap} />
  } else if (view === 'para') {
    body = <ParaView />
  } else if (view === 'burrow') {
    body = <BurrowPanel />
  } else {
    body = <HomeView childMap={childMap} />
  }

  return (
    <aside className="sidebar" style={narrow ? undefined : { width: sidebarWidth }}>
      {!narrow && <ResizeHandle edge="right" width={sidebarWidth} min={200} max={520} initial={252} onWidth={(w) => setState({ sidebarWidth: w })} label="Sidebar width" />}
      {narrow && <DrawerHead />}
      <div className="sidebar-scroll">
        {body}
        <Outline />
      </div>
    </aside>
  )
}
