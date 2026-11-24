import { useMemo } from 'react'
import { Check, FilePlus2, FileStack, Settings2, Star } from 'lucide-react'
import { Popover } from '../components/Popover'
import { openPage, setView as setSidebarView } from '../state/actions'
import { toast, useApp } from '../state/store'
import { listTemplates, templateExists } from '../templates/apply'
import { openTemplateDialog } from '../templates/TemplateDialog'
import { setDatabaseTemplate } from './api'
import type { Anchor } from './menus'

/**
 * The ▾ next to "New" in a database: a new page from any template (the form asks for its
 * fields), or an empty one; and which template "New" uses by default (the ☆ on each line).
 */
export function NewRowMenu({
  databaseId,
  current,
  at,
  onClose,
  onEmpty,
}: {
  databaseId: string
  /** The database's default template, if any. */
  current?: string
  at: Anchor
  onClose: () => void
  /** Make a row without a template. */
  onEmpty: () => void
}) {
  const pages = useApp((s) => s.pages)
  const templates = useMemo(() => listTemplates(), [pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const def = templateExists(current) ? current : null
  const setDefault = (id: string | null) =>
    setDatabaseTemplate(databaseId, id).then(
      () => toast(id ? `New pages here start from “${pages[id]?.title || 'Untitled'}”` : 'New pages here start empty'),
      (e) => toast(`Could not change it: ${e}`),
    )
  const line = (id: string | null, icon: React.ReactNode, name: string, onPick: () => void) => (
    <div key={id ?? 'empty'} className="nr-line">
      <button
        className="menu-item"
        onClick={() => {
          onClose()
          onPick()
        }}
      >
        <span className="menu-icon">{icon}</span>
        <span className="menu-label">{name}</span>
        {def === id && <small className="nr-default">default</small>}
      </button>
      <button
        className={`nr-star ${def === id ? 'on' : ''}`}
        title={def === id ? 'This is what New makes' : 'Make this what New makes'}
        aria-label={`Use ${name} for New`}
        onClick={() => void setDefault(id)}
      >
        {def === id ? <Check size={13} /> : <Star size={13} />}
      </button>
    </div>
  )
  return (
    <Popover x={at.x} y={at.y} anchorTop={at.top} onClose={onClose} className="db-menu nr-menu">
      <div className="menu-caption">New page</div>
      {line(null, <FilePlus2 size={14} />, 'Empty page', onEmpty)}
      {templates.map((t) =>
        line(t.id, <span>{t.icon || '📄'}</span>, t.title || 'Untitled', () => openTemplateDialog({ parentId: databaseId, databaseId, templateId: t.id })),
      )}
      <div className="menu-sep" />
      <button
        className="menu-item"
        onClick={() => {
          onClose()
          setSidebarView('templates')
        }}
      >
        <span className="menu-icon">{templates.length ? <Settings2 size={14} /> : <FileStack size={14} />}</span>
        <span className="menu-label">{templates.length ? 'Edit templates' : 'Make a template'}</span>
      </button>
      {def && (
        <button
          className="menu-item"
          onClick={() => {
            onClose()
            openPage(def, 'tab')
          }}
        >
          <span className="menu-icon">
            <FileStack size={14} />
          </span>
          <span className="menu-label">Open the default template</span>
        </button>
      )}
      <p className="nr-hint">☆ chooses what New makes here.</p>
    </Popover>
  )
}
