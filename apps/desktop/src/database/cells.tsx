import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Calendar,
  CheckSquare,
  CircleChevronDown,
  FolderOpen,
  Hash,
  Link,
  Maximize2,
  Plus,
  Sigma,
  Tags,
  Type,
  X,
  Play,
} from 'lucide-react'
import { Popover } from '../components/Popover'
import { uid } from '../lib/id'
import { openExternal } from '../lib/storage'
import { openPage } from '../state/actions'
import { useApp } from '../state/store'
import { createRow, queryDatabase, setProperty, setValue } from './api'
import { ALL_ROWS } from './useDatabase'
import { COLORS, TITLE, type DatabaseResult, type PropType, type Property, type Row, type RowRef, type SelectOption } from './types'

export const TYPE_ICON: Record<PropType, typeof Type> = {
  title: Type,
  text: Type,
  number: Hash,
  select: CircleChevronDown,
  multiSelect: Tags,
  date: Calendar,
  checkbox: CheckSquare,
  url: Link,
  file: FolderOpen,
  relation: ArrowUpRight,
  rollup: Sigma,
}

export function PropIcon({ type, size = 13 }: { type: PropType; size?: number }) {
  const I = TYPE_ICON[type] ?? Type
  return <I size={size} className="db-prop-icon" />
}

const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [])

export function Chip({ color, children, onRemove }: { color?: string; children: ReactNode; onRemove?: () => void }) {
  return (
    <span className={`db-chip c-${color || 'gray'}`}>
      {children}
      {onRemove && (
        <button
          className="db-chip-x"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X size={10} />
        </button>
      )}
    </span>
  )
}

/** Rollup and number display. Percent rollups show a progress bar. */
export function RollupValue({ prop, value }: { prop: Property; value: unknown }) {
  if (value == null) return <span className="db-empty" />
  if (prop.rollup?.function === 'percentChecked' && typeof value === 'number') {
    const pct = Math.round(value * 100)
    return (
      <span className="db-progress" title={`${pct}%`}>
        <span className="db-progress-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="db-progress-num">{pct}%</span>
      </span>
    )
  }
  if (Array.isArray(value)) {
    return (
      <span className="db-chips">
        {value.map((v, i) => (
          <Chip key={i}>{typeof v === 'boolean' ? (v ? '✓' : '—') : String(v)}</Chip>
        ))}
      </span>
    )
  }
  if (typeof value === 'number') return <span className="db-number">{formatNumber(value)}</span>
  return <span>{String(value)}</span>
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))

/** A text-like value edited in place; commits on Enter or blur, Escape cancels. */
function InlineInput({
  value,
  type = 'text',
  onCommit,
  onDone,
  placeholder,
}: {
  value: string
  type?: 'text' | 'number' | 'date'
  onCommit: (v: string) => void
  onDone: () => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  const done = useRef(false)
  const commit = () => {
    if (done.current) return
    done.current = true
    if (draft !== value) onCommit(draft)
    onDone()
  }
  return (
    <input
      className="db-input"
      autoFocus
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          done.current = true
          onDone()
        }
      }}
    />
  )
}

interface CellProps {
  prop: Property
  row: Row
  result: DatabaseResult
  editable: boolean
  /** Compact display for cards. */
  compact?: boolean
}

/**
 * A module can offer to open a row's file (the Course module does for lessons). Cells of type
 * File then get an open button; the module checks the file is one it was given.
 */
export const FileOpener = createContext<((rowId: string) => void) | null>(null)

/** One cell: shows the value and edits it in place (or in a picker for selects and relations). */
export function Cell({ prop, row, result, editable, compact }: CellProps) {
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState<{ x: number; y: number; top: number } | null>(null)
  const openFile = useContext(FileOpener)
  const value = row.values[prop.id]
  const save = (v: unknown) => void setValue(row.id, prop.id, v)
  const openPicker = (e: React.MouseEvent) => {
    if (!editable) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPicker({ x: r.left, y: r.bottom, top: r.top })
  }

  switch (prop.type) {
    case 'title':
      return (
        <div className="db-title-cell">
          {editing ? (
            <InlineInput value={row.title} placeholder="Untitled" onCommit={(v) => save(v)} onDone={() => setEditing(false)} />
          ) : (
            <span className="db-title" onClick={() => (editable && !compact ? setEditing(true) : openPage(row.id))}>
              {row.icon && <span className="db-row-icon">{row.icon}</span>}
              {row.title || <span className="db-placeholder">Untitled</span>}
            </span>
          )}
          {!editing && !compact && (
            <button className="db-open" title="Open as page" onClick={(e) => openPage(row.id, e.ctrlKey || e.metaKey ? 'tab' : 'replace')}>
              <Maximize2 size={11} /> Open
            </button>
          )}
        </div>
      )
    case 'checkbox':
      return <CheckboxCell checked={value === true} label={compact ? prop.name : undefined} editable={editable} onChange={save} />
    case 'rollup':
      return <RollupValue prop={prop} value={value} />
    case 'select':
    case 'multiSelect': {
      const ids = asIds(value)
      const opts = ids.map((id) => prop.options?.find((o) => o.id === id)).filter((o): o is SelectOption => !!o)
      return (
        <div className="db-cell-click" onClick={openPicker}>
          <span className="db-chips">
            {opts.map((o) => (
              <Chip key={o.id} color={o.color}>
                {o.name}
              </Chip>
            ))}
          </span>
          {picker && (
            <OptionPicker prop={prop} databaseId={result.databaseId} selected={ids} at={picker} onClose={() => setPicker(null)} onChange={save} />
          )}
        </div>
      )
    }
    case 'relation': {
      const ids = asIds(value)
      return (
        <div className="db-cell-click" onClick={openPicker}>
          <span className="db-chips">
            {ids.map((id) => {
              const r = result.related[id]
              return (
                <span
                  key={id}
                  className="db-rel"
                  onClick={(e) => {
                    e.stopPropagation()
                    openPage(id, e.ctrlKey || e.metaKey ? 'tab' : 'replace')
                  }}
                >
                  {r?.icon || '↗'} {r?.title || 'Untitled'}
                </span>
              )
            })}
          </span>
          {picker && prop.relation && (
            <RelationPicker prop={prop} selected={ids} at={picker} onClose={() => setPicker(null)} onChange={save} />
          )}
        </div>
      )
    }
    default: {
      const text = value == null ? '' : typeof value === 'number' ? formatNumber(value) : String(value)
      const inputType = prop.type === 'number' ? 'number' : prop.type === 'date' ? 'date' : 'text'
      if (editing) {
        return (
          <InlineInput
            value={value == null ? '' : String(value)}
            type={inputType}
            onCommit={(v) => save(prop.type === 'number' ? (v.trim() === '' ? null : v) : v)}
            onDone={() => setEditing(false)}
          />
        )
      }
      return (
        <div className={`db-cell-click ${prop.type === 'number' ? 'db-number' : ''}`} onClick={() => editable && setEditing(true)}>
          {prop.type === 'url' && text ? (
            <a
              href={text}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void openExternal(text)
              }}
            >
              {text}
            </a>
          ) : prop.type === 'file' && text ? (
            <span className={`db-file ${row.values.missing === true ? 'missing' : ''}`} title={row.values.missing === true ? `Missing: ${text}` : text}>
              {openFile && row.values.missing !== true ? (
                <button
                  className="db-file-open"
                  title="Open in its app"
                  aria-label="Open file"
                  onClick={(e) => {
                    e.stopPropagation()
                    openFile(row.id)
                  }}
                >
                  <Play size={11} />
                </button>
              ) : (
                <FolderOpen size={12} />
              )}
              {row.values.missing === true && <span className="db-missing">missing</span>}
              {fileName(text)}
            </span>
          ) : prop.type === 'date' && text ? (
            <span>{new Date(text + 'T00:00:00').toLocaleDateString()}</span>
          ) : (
            text
          )}
        </div>
      )
    }
  }
}

const fileName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Shows the new state at once; the query result catches up a moment later. */
function CheckboxCell({ checked, label, editable, onChange }: { checked: boolean; label?: string; editable: boolean; onChange: (v: boolean) => void }) {
  const [local, setLocal] = useState(checked)
  useEffect(() => setLocal(checked), [checked])
  return (
    <label className="db-check" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={local}
        disabled={!editable}
        onChange={(e) => {
          setLocal(e.target.checked)
          onChange(e.target.checked)
        }}
      />
      {label && <span>{label}</span>}
    </label>
  )
}

// ---------------------------------------------------------------- pickers

function PickerShell({ at, onClose, children }: { at: { x: number; y: number; top: number }; onClose: () => void; children: ReactNode }) {
  return (
    <Popover x={at.x} y={at.y} anchorTop={at.top} onClose={onClose} className="db-picker">
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </Popover>
  )
}

/** Choose (or create) select options. */
function OptionPicker({
  prop,
  databaseId,
  selected,
  at,
  onClose,
  onChange,
}: {
  prop: Property
  databaseId: string
  selected: string[]
  at: { x: number; y: number; top: number }
  onClose: () => void
  onChange: (v: unknown) => void
}) {
  const [q, setQ] = useState('')
  const multi = prop.type === 'multiSelect'
  const options = prop.options ?? []
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()))
  const exact = options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase())

  const pick = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
    else {
      onChange(selected[0] === id ? null : id)
      onClose()
    }
  }
  const create = async () => {
    const name = q.trim()
    if (!name) return
    const opt: SelectOption = { id: uid(), name, color: COLORS[(options.length + 3) % COLORS.length] }
    await setProperty(databaseId, { ...prop, options: [...options, opt] })
    pick(opt.id)
    setQ('')
  }

  return (
    <PickerShell at={at} onClose={onClose}>
      <input
        className="db-picker-search"
        autoFocus
        placeholder={multi ? 'Search or create options…' : 'Search or create an option…'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (shown[0] && q.trim()) pick(shown[0].id)
            else void create()
          }
        }}
      />
      <div className="menu-list">
        {shown.map((o) => (
          <button key={o.id} className={`menu-item ${selected.includes(o.id) ? 'active' : ''}`} onClick={() => pick(o.id)}>
            <Chip color={o.color}>{o.name}</Chip>
            {selected.includes(o.id) && <span className="menu-hint">✓</span>}
          </button>
        ))}
        {q.trim() && !exact && (
          <button className="menu-item" onClick={() => void create()}>
            <Plus size={13} /> Create <Chip>{q.trim()}</Chip>
          </button>
        )}
        {!shown.length && !q.trim() && <div className="menu-empty">No options yet. Type to create one.</div>}
      </div>
    </PickerShell>
  )
}

/** Link rows of the related database (or create one). */
function RelationPicker({
  prop,
  selected,
  at,
  onClose,
  onChange,
}: {
  prop: Property
  selected: string[]
  at: { x: number; y: number; top: number }
  onClose: () => void
  onChange: (v: unknown) => void
}) {
  const target = prop.relation!.databaseId
  const targetPage = useApp((s) => s.pages[target])
  const [rows, setRows] = useState<RowRef[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(selected)
  useEffect(() => {
    queryDatabase(target, undefined, ALL_ROWS).then((r) => setRows(r.rows), () => setRows([]))
  }, [target])
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase()
    return rows.filter((r) => (r.title || 'untitled').toLowerCase().includes(query)).slice(0, 50)
  }, [rows, q])

  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]
    setSel(next)
    onChange(next)
  }
  const create = async () => {
    const title = q.trim()
    if (!title) return
    const id = uid()
    await createRow(target, id, title)
    setRows((r) => [...r, { id, title, icon: '' }])
    toggle(id)
    setQ('')
  }

  return (
    <PickerShell at={at} onClose={onClose}>
      <div className="menu-caption">Link to {targetPage?.title || 'database'}</div>
      <input
        className="db-picker-search"
        autoFocus
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (shown[0] ? toggle(shown[0].id) : void create())}
      />
      <div className="menu-list">
        {shown.map((r) => (
          <button key={r.id} className={`menu-item ${sel.includes(r.id) ? 'active' : ''}`} onClick={() => toggle(r.id)}>
            <span className="menu-icon">{r.icon || '📄'}</span>
            <span className="menu-label">{r.title || 'Untitled'}</span>
            {sel.includes(r.id) && <span className="menu-hint">✓</span>}
          </button>
        ))}
        {q.trim() && !rows.some((r) => r.title.toLowerCase() === q.trim().toLowerCase()) && (
          <button className="menu-item" onClick={() => void create()}>
            <Plus size={13} /> New “{q.trim()}” in {targetPage?.title || 'database'}
          </button>
        )}
        {!shown.length && !q.trim() && <div className="menu-empty">No rows in {targetPage?.title || 'that database'} yet.</div>}
      </div>
    </PickerShell>
  )
}

/** The columns a view shows, title first, then in column order. */
export function visibleProps(result: DatabaseResult): Property[] {
  const { properties, view } = result
  const hidden = new Set(view.hidden ?? [])
  const title = properties.find((p) => p.id === TITLE)
  const rest = properties.filter((p) => p.id !== TITLE && !hidden.has(p.id))
  return title ? [title, ...rest] : rest
}
