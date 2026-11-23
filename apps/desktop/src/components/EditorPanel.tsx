import { useRef, useState } from 'react'
import { showsCanvas, useRoles } from '../dnd/api'
import { Archive, ArchiveRestore, ChevronRight, Search, FileStack, ClipboardCopy, Copy, FilePlus2, FileText, Maximize2, Minimize2, MoreHorizontal, BookmarkCheck, Palette, Plus, Shapes, Star, Table2, Trash2, X } from 'lucide-react'
import { ancestors, closeTab, convertPage, createPage, duplicatePage, openPage, setArchived, toggleFavorite, trashPage } from '../state/actions'
import { getState, setState, toast, useApp } from '../state/store'
import { Editor, pageMarkdown } from '../editor/Editor'
import { IconButton } from './TopBar'
import { MenuList, Popover, type MenuEntry } from './Popover'
import { openPageThemeMenu, usePageThemeStyle } from '../theme/PageTheme'
import { saveAsTemplate } from '../templates/apply'
import { openTemplateDialog } from '../templates/TemplateDialog'
import { openSaveToBurrow } from '../burrow/Save'
import { useNarrow } from '../mobile/narrow'
import { MobileHeader } from '../mobile/MobileChrome'
import { SyncChip } from '../sync/SyncDialog'

function Tab({ id }: { id: string }) {
  const page = useApp((s) => s.pages[id])
  const active = useApp((s) => s.activeId === id)
  if (!page) return null
  return (
    <div
      className={`tab ${active ? 'active' : ''}`}
      role="tab"
      aria-selected={active}
      onClick={() => setState({ activeId: id })}
      onAuxClick={(e) => e.button === 1 && closeTab(id)}
      title={page.title || 'Untitled'}
    >
      <span>{page.icon || <FileText size={13} />}</span>
      <span className="tab-title">{page.title || 'Untitled'}</span>
      <button
        className="tab-close"
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation()
          closeTab(id)
        }}
      >
        <X size={13} />
      </button>
    </div>
  )
}

function Breadcrumb({ pageId }: { pageId: string }) {
  const page = useApp((s) => s.pages[pageId])
  useApp((s) => s.pages) // re-render on ancestor renames
  const outline = useApp((s) => s.outline)
  const current = useApp((s) => s.currentHeading)
  if (!page) return null
  const trail = ancestors(pageId)
  const heading = outline.find((o) => o.id === current)
  return (
    <div className="breadcrumb">
      <FileText size={15} />
      {trail.map((p) => (
        <span key={p.id} className="crumb-wrap">
          <ChevronRight size={13} />
          <button className="crumb" onClick={() => openPage(p.id)}>
            {p.icon && <span>{p.icon}</span>}
            {p.title || 'Untitled'}
          </button>
        </span>
      ))}
      <ChevronRight size={13} />
      <span className="crumb current">{page.title || 'Untitled'}</span>
      {heading && (
        <>
          <ChevronRight size={13} />
          <span className="muted-text">{heading.text}</span>
        </>
      )}
    </div>
  )
}

function StatusBar() {
  const save = useApp((s) => s.save)
  const err = useApp((s) => s.saveError)
  const stats = useApp((s) => s.stats)
  const theme = useApp((s) => s.theme)
  const hasPage = useApp((s) => !!s.activeId)
  return (
    <div className="statusbar">
      <span className={`save-state ${save}`} title={err ?? ''}>
        {save === 'saved' ? 'All changes saved' : save === 'saving' ? 'Saving…' : 'Save failed — see console'}
      </span>
      {hasPage && <span>Words {stats.words}</span>}
      {hasPage && <span>Blocks {stats.blocks}</span>}
      <button onClick={() => setState({ theme: theme === 'dark' ? 'light' : 'dark' })} aria-label="Toggle theme" title="Toggle theme">
        {theme === 'dark' ? '☼' : '☾'}
      </button>
    </div>
  )
}

function Empty() {
  return (
    <div className="empty-state">
      <div className="empty-mark">✦</div>
      <h2>No page open</h2>
      <p>Pick a page from the sidebar or start a new one.</p>
      <button className="primary-btn" onClick={() => createPage()}>
        <FilePlus2 size={14} /> New page
      </button>
      <p className="muted-text small">
        <kbd>Ctrl</kbd> <kbd>K</kbd> to search · <kbd>Ctrl</kbd> <kbd>N</kbd> for a new page
      </p>
    </div>
  )
}

export function EditorPanel() {
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const page = useApp((s) => (s.activeId ? s.pages[s.activeId] : undefined))
  const width = useApp((s) => s.width)
  const choice = useApp((s) => s.edgeless)
  const roles = useRoles()
  const edgeless = activeId ? showsCanvas(activeId, choice, roles) : false
  const [more, setMore] = useState<{ x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // The open page's own theme (or its parent's) restyles this pane; the sidebars keep the app's.
  const { style: pageTheme, theme: pageThemeDef } = usePageThemeStyle(activeId)
  const narrow = useNarrow()

  return (
    <section className={`editor-panel ${pageThemeDef ? `page-themed page-${pageThemeDef.base}` : ''}`} style={pageTheme}>
      {narrow ? (
        <MobileHeader page={page} onMore={() => setMore({ x: 0, y: 0 })} />
      ) : (
      <div className="tabs-bar">
        <div className="tabs-scroll" role="tablist">
          {tabs.map((id) => (
            <Tab key={id} id={id} />
          ))}
          <button className="new-tab" aria-label="New page in new tab" title="New page (Ctrl N)" onClick={() => createPage({ open: 'tab' })}>
            <Plus />
          </button>
        </div>
        <div className="tabs-end">
          <SyncChip />
          <IconButton label="Search (Ctrl K)" onClick={() => setState({ quickFind: true })}>
            <Search />
          </IconButton>
        </div>
      </div>
      )}
      {page && activeId ? (
        <>
          {!narrow && (
            <div className="crumb-bar">
              <Breadcrumb pageId={activeId} />
          {page && (
            <div className="editor-actions">
              {page.kind !== 'database' && (
                <div className="mode-switch" role="group" aria-label="View">
                  <button
                    className={!edgeless ? 'active' : ''}
                    title="Document (Ctrl Shift E)"
                    aria-pressed={!edgeless}
                    onClick={() => setState((s) => ({ edgeless: { ...s.edgeless, [page.id]: false } }))}
                  >
                    <FileText size={14} />
                  </button>
                  <button
                    className={edgeless ? 'active' : ''}
                    title="Canvas (Ctrl Shift E)"
                    aria-pressed={edgeless}
                    onClick={() => setState((s) => ({ edgeless: { ...s.edgeless, [page.id]: true } }))}
                  >
                    <Shapes size={14} />
                  </button>
                </div>
              )}
              <IconButton label={page.favorite ? 'Remove from favorites' : 'Add to favorites'} active={page.favorite} onClick={() => toggleFavorite(page.id)}>
                <Star className={page.favorite ? 'star-on' : ''} />
              </IconButton>
              <IconButton
                label="Copy as Markdown"
                onClick={async () => {
                  await navigator.clipboard?.writeText(await pageMarkdown(page.id))
                  toast('Page copied as Markdown')
                }}
              >
                <ClipboardCopy />
              </IconButton>
              <IconButton
                label="More options"
                active={!!more}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setMore({ x: r.right - 220, y: r.bottom })
                }}
              >
                <MoreHorizontal />
              </IconButton>
            </div>
          )}
            </div>
          )}
          <Editor key={activeId} pageId={activeId} scrollRef={scrollRef} />
        </>
      ) : (
        <Empty />
      )}
      <StatusBar />
      {more && page && (
        <Popover x={more.x} y={more.y} onClose={() => setMore(null)}>
          <MenuList
            onDone={() => setMore(null)}
            items={[
              ...(narrow
                ? [
                    page.kind !== 'database' &&
                      (edgeless
                        ? { label: 'Document view', icon: <FileText size={14} />, onSelect: () => setState((s) => ({ edgeless: { ...s.edgeless, [page.id]: false } })) }
                        : { label: 'Canvas view', icon: <Shapes size={14} />, onSelect: () => setState((s) => ({ edgeless: { ...s.edgeless, [page.id]: true } })) }),
                    {
                      label: 'Copy as Markdown',
                      icon: <ClipboardCopy size={14} />,
                      onSelect: async () => {
                        await navigator.clipboard?.writeText(await pageMarkdown(page.id))
                        toast('Page copied as Markdown')
                      },
                    },
                    'sep' as const,
                  ].filter((x) => !!x) as (MenuEntry | 'sep')[]
                : []),
              ...(narrow
                ? []
                : [
                    {
                      label: width === 'wide' ? 'Normal width' : 'Full width',
                      icon: width === 'wide' ? <Minimize2 size={14} /> : <Maximize2 size={14} />,
                      onSelect: () => setState({ width: getState().width === 'wide' ? 'normal' : 'wide' }),
                    },
                  ]),
              { label: 'Page theme…', icon: <Palette size={14} />, onSelect: () => setTimeout(openPageThemeMenu) },
              { label: 'Save to Burrow…', icon: <BookmarkCheck size={14} />, onSelect: () => openSaveToBurrow(page.id) },
              { label: 'Add sub-page', icon: <Plus size={14} />, onSelect: () => createPage({ parentId: page.id }) },
              { label: 'Add sub-page from template…', icon: <FileStack size={14} />, onSelect: () => openTemplateDialog({ parentId: page.id }) },
              ...(page.databaseId
                ? []
                : page.kind === 'database'
                  ? [{ label: 'Turn into page', icon: <FileText size={14} />, onSelect: () => void convertPage(page.id, 'page') }]
                  : [{ label: 'Turn into database', icon: <Table2 size={14} />, onSelect: () => void convertPage(page.id, 'database') }]),
              { label: 'Duplicate page', icon: <Copy size={14} />, onSelect: () => duplicatePage(page.id) },
              { label: 'Save as template', icon: <FileStack size={14} />, onSelect: () => void saveAsTemplate(page.id) },
              'sep',
              page.archived
                ? { label: 'Unarchive', icon: <ArchiveRestore size={14} />, onSelect: () => setArchived(page.id, false) }
                : { label: 'Archive', icon: <Archive size={14} />, onSelect: () => setArchived(page.id, true) },
              { label: 'Move to trash', icon: <Trash2 size={14} />, danger: true, onSelect: () => trashPage(page.id) },
            ]}
          />
        </Popover>
      )}
    </section>
  )
}
