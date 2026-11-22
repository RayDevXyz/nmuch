import { useState } from 'react'
import { ArrowUpDown, ChevronDown, Filter as FilterIcon, FolderInput, LayoutGrid, Play, Plus, RefreshCw, Settings2, Sparkles, SquareKanban, Table2 } from 'lucide-react'
import { MenuList, Popover } from '../components/Popover'
import { uid } from '../lib/id'
import { openPage } from '../state/actions'
import { createRow, removeView, setValue, setView } from './api'
import { Cell, FileOpener, PropIcon, visibleProps } from './cells'
import { useCourseActions } from '../modules/course'
import { useRoles } from '../dnd/api'
import { openCharacterWizard } from '../dnd/CharacterWizard'
import { dndSlashExtras } from '../dnd/slash'
import { AddPropertyMenu, anchorOf, FilterMenu, PropertyMenu, SortMenu, ViewSettingsMenu, type Anchor } from './menus'
import { useDatabase } from './useDatabase'
import type { DatabaseResult, Property, Row, ViewKind } from './types'

export const VIEW_ICON: Record<ViewKind, typeof Table2> = { table: Table2, board: SquareKanban, gallery: LayoutGrid }

type Menu =
  | { kind: 'prop'; prop: Property; at: Anchor }
  | { kind: 'add-prop' | 'filter' | 'sort' | 'settings' | 'add-view'; at: Anchor }
  | null

/**
 * A database: view tabs, toolbar, and the current view as a table, board or gallery.
 * Used full-page (a database page) and inline (the `database` block in a note).
 */
export function DatabaseView({
  databaseId,
  viewId,
  onViewChange,
  inline,
  linked,
  editable = true,
}: {
  databaseId: string
  viewId?: string
  onViewChange?: (viewId: string) => void
  inline?: boolean
  /** Shown on a page that isn't the database's own (a linked view). */
  linked?: boolean
  editable?: boolean
}) {
  const [localView, setLocalView] = useState<string | undefined>(viewId)
  const current = onViewChange ? viewId : localView
  const { result, error, refresh } = useDatabase(databaseId, current)
  const [menu, setMenu] = useState<Menu>(null)
  const course = useCourseActions(databaseId)
  const dndRole = useRoles()[databaseId]
  const close = () => setMenu(null)
  const choose = (id: string) => (onViewChange ? onViewChange(id) : setLocalView(id))

  if (error) return <div className="db-error">Could not load this database: {error}</div>
  if (!result) return <div className="db-loading">Loading…</div>
  const view = result.view

  const addRow = async (values: Record<string, unknown> = {}) => {
    await createRow(databaseId, uid(), '', values)
    await refresh()
  }

  const addView = async (type: ViewKind) => {
    const id = uid()
    const firstSelect = result.properties.find((p) => p.type === 'select')
    await setView(databaseId, {
      id,
      name: type === 'table' ? 'Table' : type === 'board' ? 'Board' : 'Gallery',
      type,
      order: '',
      filters: [],
      sorts: [],
      groupBy: type === 'board' ? firstSelect?.id : undefined,
    })
    choose(id)
  }

  return (
    <div className={`db ${inline ? 'db-inline' : 'db-full'}`}>
      {inline && (
        <button className="db-heading" onClick={(e) => openPage(databaseId, e.ctrlKey || e.metaKey ? 'tab' : 'replace')} title="Open the database as a page">
          <span>{result.icon || '🗂️'}</span> {result.title || 'Untitled database'}
          {linked && <small className="db-linked" title="This database lives on another page; edits here show there too">↗ Linked</small>}
        </button>
      )}
      <div className="db-bar">
        <div className="db-tabs" role="tablist">
          {result.views.map((v) => {
            const Icon = VIEW_ICON[v.type]
            const active = v.id === view.id
            return (
              <button
                key={v.id}
                role="tab"
                aria-selected={active}
                className={`db-tab ${active ? 'active' : ''}`}
                onClick={(e) => (active && editable ? setMenu({ kind: 'settings', at: anchorOf(e) }) : choose(v.id))}
              >
                <Icon size={13} /> {v.name}
                {active && editable && <ChevronDown size={11} />}
              </button>
            )
          })}
          {editable && (
            <button className="db-tab add" aria-label="Add view" onClick={(e) => setMenu({ kind: 'add-view', at: anchorOf(e) })}>
              <Plus size={13} />
            </button>
          )}
        </div>
        {editable && (
          <div className="db-tools">
            <button className={`db-tool ${view.filters.length ? 'on' : ''}`} onClick={(e) => setMenu({ kind: 'filter', at: anchorOf(e) })}>
              <FilterIcon size={13} /> Filter{view.filters.length ? ` · ${view.filters.length}` : ''}
            </button>
            <button className={`db-tool ${view.sorts.length ? 'on' : ''}`} onClick={(e) => setMenu({ kind: 'sort', at: anchorOf(e) })}>
              <ArrowUpDown size={13} /> Sort{view.sorts.length ? ` · ${view.sorts.length}` : ''}
            </button>
            <button className="db-tool" aria-label="View settings" onClick={(e) => setMenu({ kind: 'settings', at: anchorOf(e) })}>
              <Settings2 size={13} />
            </button>
            {dndRole === 'characters' && (
              <button className="db-tool" title="Create a character from your 5etools races, classes and backgrounds" onClick={() => openCharacterWizard()}>
                <Sparkles size={13} /> New character
              </button>
            )}
            {dndRole === 'campaigns' && (
              <button className="db-tool" onClick={() => dndSlashExtras.find((x) => x.id === 'dnd-campaign')!.run(null as never)}>
                <Sparkles size={13} /> New campaign
              </button>
            )}
            {course?.role === 'courses' && (
              <button className="db-tool" title="Turn a folder of videos and documents into a course" onClick={() => void course.importFolder()}>
                <FolderInput size={13} /> Import folder
              </button>
            )}
            <button className="db-new" onClick={() => void addRow()}>
              <Plus size={13} /> New
            </button>
          </div>
        )}
      </div>

      {course?.role === 'courses' && result.total === 0 && (
        <div className="course-empty">
          <div className="course-empty-icon">🎓</div>
          <div>
            <strong>No courses yet</strong>
            <p>
              Pick a folder of videos and documents (for example <code>Courses/Rust</code>). Every file becomes a lesson, in
              order, with subfolders as sections. New files show up by themselves.
            </p>
            {editable && (
              <button className="primary-btn" onClick={() => void course.importFolder()}>
                <FolderInput size={14} /> Import a course folder
              </button>
            )}
          </div>
        </div>
      )}
      <FileOpener.Provider value={course?.role === 'lessons' ? course.openLesson : null}>
        {view.type === 'table' && <TableView result={result} editable={editable} setMenu={setMenu} onAdd={() => void addRow()} />}
        {view.type === 'board' && <BoardView result={result} editable={editable} onAdd={addRow} setMenu={setMenu} />}
        {view.type === 'gallery' && <GalleryView result={result} editable={editable} onAdd={() => void addRow()} />}
      </FileOpener.Provider>
      {result.rows.length < result.total && (
        <div className="db-footnote">
          {result.total - result.rows.length} row{result.total - result.rows.length === 1 ? '' : 's'} hidden by filters
        </div>
      )}

      {menu?.kind === 'prop' && <PropertyMenu result={result} prop={menu.prop} at={menu.at} onClose={close} />}
      {menu?.kind === 'add-prop' && <AddPropertyMenu result={result} at={menu.at} onClose={close} />}
      {menu?.kind === 'filter' && <FilterMenu result={result} at={menu.at} onClose={close} />}
      {menu?.kind === 'sort' && <SortMenu result={result} at={menu.at} onClose={close} />}
      {menu?.kind === 'settings' && (
        <ViewSettingsMenu
          result={result}
          at={menu.at}
          onClose={close}
          onDelete={
            result.views.length > 1
              ? () => {
                  close()
                  void removeView(databaseId, view.id).then(() => choose(result.views.find((v) => v.id !== view.id)!.id))
                }
              : undefined
          }
        />
      )}
      {menu?.kind === 'add-view' && (
        <Popover x={menu.at.x} y={menu.at.y} anchorTop={menu.at.top} onClose={close}>
          <MenuList
            onDone={close}
            items={(['table', 'board', 'gallery'] as ViewKind[]).map((t) => {
              const Icon = VIEW_ICON[t]
              return { label: t[0].toUpperCase() + t.slice(1), icon: <Icon size={14} />, onSelect: () => void addView(t) }
            })}
          />
        </Popover>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- table

function TableView({
  result,
  editable,
  setMenu,
  onAdd,
}: {
  result: DatabaseResult
  editable: boolean
  setMenu: (m: Menu) => void
  onAdd: () => void
}) {
  const props = visibleProps(result)
  return (
    <div className="db-table-wrap">
      <table className="db-table">
        <thead>
          <tr>
            {props.map((p) => (
              <th key={p.id} className={`t-${p.type}`} onClick={(e) => editable && setMenu({ kind: 'prop', prop: p, at: anchorOf(e) })}>
                <PropIcon type={p.type} /> {p.name}
              </th>
            ))}
            {editable && (
              <th className="db-add-col" aria-label="Add a column" onClick={(e) => setMenu({ kind: 'add-prop', at: anchorOf(e) })}>
                <Plus size={13} />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              {props.map((p) => (
                <td key={p.id} className={`t-${p.type}`}>
                  <Cell prop={p} row={row} result={result} editable={editable} />
                </td>
              ))}
              {editable && <td />}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button className="db-add-row" onClick={onAdd}>
          <Plus size={13} /> New
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- cards (board + gallery)

function Card({ row, result, editable, draggable }: { row: Row; result: DatabaseResult; editable: boolean; draggable?: boolean }) {
  const props = visibleProps(result).filter((p) => p.id !== 'title' && p.id !== result.view.groupBy)
  return (
    <div
      className="db-card"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-bw-row', row.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <div className="db-card-title" onClick={(e) => openPage(row.id, e.ctrlKey || e.metaKey ? 'tab' : 'replace')}>
        {row.icon && <span>{row.icon}</span>} {row.title || <span className="db-placeholder">Untitled</span>}
      </div>
      {props.map((p) =>
        row.values[p.id] == null && p.type !== 'checkbox' ? null : (
          <div key={p.id} className="db-card-prop" title={p.name}>
            {needsLabel(p) && <span className="db-card-label">{p.name}</span>}
            <Cell prop={p} row={row} result={result} editable={editable} compact />
          </div>
        ),
      )}
    </div>
  )
}

/** On cards, values that don't explain themselves (numbers, dates, text) get their column name. */
const needsLabel = (p: Property) =>
  ['number', 'date', 'text', 'url', 'file'].includes(p.type) || (p.type === 'rollup' && p.rollup?.function !== 'percentChecked')

function BoardView({
  result,
  editable,
  onAdd,
  setMenu,
}: {
  result: DatabaseResult
  editable: boolean
  onAdd: (values?: Record<string, unknown>) => Promise<void>
  setMenu: (m: Menu) => void
}) {
  const [over, setOver] = useState<string | null>(null)
  const groupBy = result.view.groupBy
  if (!groupBy || !result.groups.length) {
    const hasSelect = result.properties.some((p) => p.type === 'select')
    return (
      <div className="db-empty-view">
        A board groups rows by a <strong>Select</strong> column.{' '}
        {hasSelect ? (
          <button className="ghost-btn" onClick={(e) => setMenu({ kind: 'settings', at: anchorOf(e) })}>
            Choose one
          </button>
        ) : (
          <button className="ghost-btn" onClick={(e) => setMenu({ kind: 'add-prop', at: anchorOf(e) })}>
            Add a Select column
          </button>
        )}
      </div>
    )
  }
  const byId = new Map(result.rows.map((r) => [r.id, r]))
  return (
    <div className="db-board">
      {result.groups.map((g) => {
        const key = g.id ?? '__none'
        return (
          <div
            key={key}
            className={`db-column ${over === key ? 'over' : ''}`}
            onDragOver={(e) => {
              if (!editable || !e.dataTransfer.types.includes('application/x-bw-row')) return
              e.preventDefault()
              setOver(key)
            }}
            onDragLeave={() => setOver((o) => (o === key ? null : o))}
            onDrop={(e) => {
              setOver(null)
              const rowId = e.dataTransfer.getData('application/x-bw-row')
              if (rowId) void setValue(rowId, groupBy, g.id)
            }}
          >
            <div className="db-column-head">
              <span className={`db-chip c-${g.color || 'gray'}`}>{g.name}</span>
              <span className="db-count">{g.rows.length}</span>
            </div>
            {g.rows.map((id) => {
              const row = byId.get(id)
              return row ? <Card key={id} row={row} result={result} editable={editable} draggable={editable} /> : null
            })}
            {editable && (
              <button className="db-add-row" onClick={() => void onAdd(g.id ? { [groupBy]: g.id } : {})}>
                <Plus size={13} /> New
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function GalleryView({ result, editable, onAdd }: { result: DatabaseResult; editable: boolean; onAdd: () => void }) {
  return (
    <div className="db-gallery">
      {result.rows.map((row) => (
        <Card key={row.id} row={row} result={result} editable={editable} />
      ))}
      {editable && (
        <button className="db-card db-card-new" onClick={onAdd}>
          <Plus size={14} /> New
        </button>
      )}
    </div>
  )
}

/** A row's values, shown at the top of the row when it is opened as a page. */
export function RowProperties({ rowId, databaseId }: { rowId: string; databaseId: string }) {
  const { result } = useDatabase(databaseId, undefined, { id: '', name: '', type: 'table', order: '', filters: [], sorts: [] })
  const course = useCourseActions(databaseId)
  const row = result?.rows.find((r) => r.id === rowId)
  if (!result || !row) return null
  const props = result.properties.filter((p) => p.id !== 'title')
  const file = typeof row.values.file === 'string' && row.values.missing !== true
  return (
    <FileOpener.Provider value={course?.role === 'lessons' ? course.openLesson : null}>
    <div className="db-row-props">
      <div className="db-row-head">
        <button className="db-row-parent" onClick={(e) => openPage(databaseId, e.ctrlKey || e.metaKey ? 'tab' : 'replace')}>
          {result.icon || '🗂️'} {result.title || 'Untitled database'}
        </button>
        {course?.role === 'lessons' && file && (
          <button className="db-row-action primary" onClick={() => course.openLesson(rowId)}>
            <Play size={13} /> Open lesson
          </button>
        )}
        {course?.role === 'courses' && typeof row.values.folder === 'string' && (
          <button className="db-row-action" title="Compare the course with its folder now" onClick={() => course.sync(rowId)}>
            <RefreshCw size={13} /> Sync with folder
          </button>
        )}
      </div>
      {props.map((p) => (
        <div key={p.id} className="db-row-prop">
          <span className="db-row-label">
            <PropIcon type={p.type} /> {p.name}
          </span>
          <div className="db-row-value">
            <Cell prop={p} row={row} result={result} editable />
          </div>
        </div>
      ))}
    </div>
    </FileOpener.Provider>
  )
}
