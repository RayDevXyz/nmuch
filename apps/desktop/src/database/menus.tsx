import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, EyeOff, Plus, Trash2, X } from 'lucide-react'
import { Popover } from '../components/Popover'
import { uid } from '../lib/id'
import { toast, useApp } from '../state/store'
import { listTemplates, templateExists } from '../templates/apply'
import { createRelation, databaseDef, removeProperty, setDatabaseTemplate, setProperty, setView } from './api'
import { Chip, PropIcon } from './cells'
import {
  COLORS,
  FILTER_LABEL,
  ROLLUP_LABEL,
  TITLE,
  TYPE_LABEL,
  type DatabaseResult,
  type Filter,
  type FilterOp,
  type PropType,
  type Property,
  type RollupFn,
  type View,
} from './types'

export interface Anchor {
  x: number
  y: number
  top?: number
}

export const anchorOf = (e: React.MouseEvent): Anchor => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: r.left, y: r.bottom, top: r.top }
}

const SIMPLE_TYPES: PropType[] = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url', 'file']
const ALL_NEW_TYPES: PropType[] = [...SIMPLE_TYPES, 'relation', 'rollup']
const ROLLUP_FNS = Object.keys(ROLLUP_LABEL) as RollupFn[]

/** Database pages the user can relate to. */
function useDatabases() {
  const pages = useApp((s) => s.pages)
  return useMemo(() => Object.values(pages).filter((p) => p.kind === 'database' && p.trashedAt == null), [pages])
}

// ---------------------------------------------------------------- rollup settings (shared)

function RollupFields({
  result,
  value,
  onChange,
}: {
  result: DatabaseResult
  value: { relation: string; property: string; function: RollupFn }
  onChange: (v: { relation: string; property: string; function: RollupFn }) => void
}) {
  const relations = result.properties.filter((p) => p.type === 'relation')
  const rel = relations.find((p) => p.id === value.relation)
  const [targetProps, setTargetProps] = useState<Property[]>([])
  useEffect(() => {
    if (!rel?.relation) return setTargetProps([])
    databaseDef(rel.relation.databaseId).then(
      (d) => setTargetProps(d.properties.filter((p) => p.type !== 'rollup' && !p.relation?.computed)),
      () => setTargetProps([]),
    )
  }, [rel?.relation?.databaseId])

  if (!relations.length) return <div className="menu-empty">Add a Relation column first: a rollup summarizes the related rows.</div>
  return (
    <div className="db-form">
      <label>
        Relation
        <select value={value.relation} onChange={(e) => onChange({ ...value, relation: e.target.value, property: TITLE })}>
          <option value="">Choose…</option>
          {relations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Property
        <select value={value.property} onChange={(e) => onChange({ ...value, property: e.target.value })} disabled={!rel}>
          {targetProps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Calculate
        <select value={value.function} onChange={(e) => onChange({ ...value, function: e.target.value as RollupFn })}>
          {ROLLUP_FNS.map((f) => (
            <option key={f} value={f}>
              {ROLLUP_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

// ---------------------------------------------------------------- add a column

export function AddPropertyMenu({ result, at, onClose }: { result: DatabaseResult; at: Anchor; onClose: () => void }) {
  const [type, setType] = useState<PropType | null>(null)
  const [name, setName] = useState('')
  const databases = useDatabases()
  const [target, setTarget] = useState('')
  const [twoWay, setTwoWay] = useState(true)
  const [rollup, setRollup] = useState<{ relation: string; property: string; function: RollupFn }>({
    relation: result.properties.find((p) => p.type === 'relation')?.id ?? '',
    property: TITLE,
    function: 'count',
  })
  const [error, setError] = useState<string | null>(null)
  const db = result.databaseId

  const create = async () => {
    if (!type) return
    const label = name.trim() || TYPE_LABEL[type]
    try {
      if (type === 'relation') {
        if (!target) return setError('Choose the database to relate to.')
        await createRelation(db, { name: label, targetDatabase: target, twoWay, reverseName: result.title || 'Related' })
      } else if (type === 'rollup') {
        if (!rollup.relation) return setError('Choose a relation.')
        await setProperty(db, { id: uid(), name: label, type, rollup })
      } else {
        await setProperty(db, { id: uid(), name: label, type, options: [] })
      }
      onClose()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <Popover x={at.x} y={at.y} anchorTop={at.top} onClose={onClose} className="db-menu">
      {!type ? (
        <div className="menu-list">
          <div className="menu-caption">Add a column</div>
          {ALL_NEW_TYPES.map((t) => (
            <button key={t} className="menu-item" onClick={() => setType(t)}>
              <span className="menu-icon">
                <PropIcon type={t} />
              </span>
              <span className="menu-label">{TYPE_LABEL[t]}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="db-form">
          <div className="menu-caption">New {TYPE_LABEL[type]} column</div>
          <input autoFocus placeholder={TYPE_LABEL[type]} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
          {type === 'relation' && (
            <>
              <label>
                Related database
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose…</option>
                  {databases.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.icon} {d.title || 'Untitled'}
                      {d.id === db ? ' (this database)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {target && target !== db && (
                <label className="db-check-row">
                  <input type="checkbox" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} />
                  Also show on {databases.find((d) => d.id === target)?.title || 'that database'}
                </label>
              )}
            </>
          )}
          {type === 'rollup' && <RollupFields result={result} value={rollup} onChange={setRollup} />}
          {error && <div className="db-error">{error}</div>}
          <div className="db-form-actions">
            <button className="ghost-btn" onClick={() => setType(null)}>
              Back
            </button>
            <button className="primary-btn" onClick={() => void create()}>
              Add column
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}

// ---------------------------------------------------------------- edit a column

export function PropertyMenu({ result, prop, at, onClose }: { result: DatabaseResult; prop: Property; at: Anchor; onClose: () => void }) {
  const db = result.databaseId
  const [name, setName] = useState(prop.name)
  const [error, setError] = useState<string | null>(null)
  const pages = useApp((s) => s.pages)
  const save = (p: Property) => setProperty(db, p).catch((e) => setError(String(e)))
  const options = prop.options ?? []

  const hide = async () => {
    await setView(db, { ...result.view, hidden: [...(result.view.hidden ?? []), prop.id] })
    onClose()
  }

  return (
    <Popover x={at.x} y={at.y} anchorTop={at.top} onClose={onClose} className="db-menu">
      <div className="db-form">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== prop.name && void save({ ...prop, name: name.trim() })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              void save({ ...prop, name: name.trim() })
              onClose()
            }
          }}
        />
        {SIMPLE_TYPES.includes(prop.type) && (
          <label>
            Type
            <select value={prop.type} onChange={(e) => void save({ ...prop, type: e.target.value as PropType })}>
              {SIMPLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        )}
        {prop.type === 'relation' && prop.relation && (
          <div className="db-note">
            Related to <strong>{pages[prop.relation.databaseId]?.title || 'a database'}</strong>
            {prop.relation.computed ? ' (the other side of a two-way relation)' : prop.relation.syncedProperty ? ' · two-way' : ''}
          </div>
        )}
        {prop.type === 'rollup' && prop.rollup && <RollupFields result={result} value={prop.rollup} onChange={(r) => void save({ ...prop, rollup: r })} />}
        {(prop.type === 'select' || prop.type === 'multiSelect') && (
          <div className="db-options">
            <div className="menu-caption">Options</div>
            {options.map((o, i) => (
              <div key={o.id} className="db-option-row">
                <select
                  className={`db-color c-${o.color}`}
                  value={o.color}
                  onChange={(e) => void save({ ...prop, options: options.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })}
                >
                  {COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  defaultValue={o.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== o.name && void save({ ...prop, options: options.map((x, j) => (j === i ? { ...x, name: e.target.value.trim() } : x)) })}
                />
                <button className="icon-btn" aria-label="Delete option" onClick={() => void save({ ...prop, options: options.filter((_, j) => j !== i) })}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              className="menu-item"
              onClick={() => void save({ ...prop, options: [...options, { id: uid(), name: `Option ${options.length + 1}`, color: COLORS[(options.length + 3) % COLORS.length] }] })}
            >
              <Plus size={13} /> Add option
            </button>
          </div>
        )}
        {error && <div className="db-error">{error}</div>}
        <div className="menu-sep" />
        <div className="menu-list">
          {prop.id !== TITLE && (
            <button className="menu-item" onClick={() => void hide()}>
              <span className="menu-icon">
                <EyeOff size={14} />
              </span>
              <span className="menu-label">Hide in this view</span>
            </button>
          )}
          {prop.id !== TITLE && (
            <button
              className="menu-item danger"
              onClick={async () => {
                const pair = prop.relation?.syncedProperty ? ' Its column in the other database is removed too.' : ''
                if (!window.confirm(`Delete the column “${prop.name}”?${pair}`)) return
                await removeProperty(db, prop.id).catch((e) => setError(String(e)))
                onClose()
              }}
            >
              <span className="menu-icon">
                <Trash2 size={14} />
              </span>
              <span className="menu-label">Delete column</span>
            </button>
          )}
        </div>
      </div>
    </Popover>
  )
}

// ---------------------------------------------------------------- filters, sorts, columns

const OPS: FilterOp[] = ['is', 'isNot', 'contains', 'notContains', 'gt', 'lt', 'empty', 'notEmpty']

export function FilterMenu({ result, at, onClose }: { result: DatabaseResult; at: Anchor; onClose: () => void }) {
  const view = result.view
  const update = (filters: Filter[]) => void setView(result.databaseId, { ...view, filters })
  const prop = (id: string) => result.properties.find((p) => p.id === id)

  return (
    <Popover x={at.x} y={at.y} anchorTop={at.top} onClose={onClose} className="db-menu wide">
      <div className="db-form">
        <div className="menu-caption">Filters (all must match)</div>
        {view.filters.map((f, i) => {
          const p = prop(f.property)
          const set = (patch: Partial<Filter>) => update(view.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <div key={i} className="db-filter-row">
              <select value={f.property} onChange={(e) => set({ property: e.target.value, value: null })}>
                {result.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={f.op} onChange={(e) => set({ op: e.target.value as FilterOp })}>
                {OPS.map((o) => (
                  <option key={o} value={o}>
                    {FILTER_LABEL[o]}
                  </option>
                ))}
              </select>
              {f.op !== 'empty' && f.op !== 'notEmpty' && <FilterValue prop={p} result={result} value={f.value} onChange={(value) => set({ value })} />}
              <button className="icon-btn" aria-label="Remove filter" onClick={() => update(view.filters.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </div>
          )
        })}
        <button className="menu-item" onClick={() => update([...view.filters, { property: TITLE, op: 'contains', value: '' }])}>
          <Plus size={13} /> Add filter
        </button>
      </div>
    </Popover>
  )
}

function FilterValue({ prop, result, value, onChange }: { prop?: Property; result: DatabaseResult; value: unknown; onChange: (v: unknown) => void }) {
  if (prop?.type === 'checkbox') {
    return (
      <select value={value === true ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    )
  }
  if (prop?.type === 'select' || prop?.type === 'multiSelect') {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {(prop.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  if (prop?.type === 'relation') {
    const ids = new Set<string>()
    result.rows.forEach((r) => (Array.isArray(r.values[prop.id]) ? (r.values[prop.id] as string[]) : []).forEach((id) => ids.add(id)))
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {[...ids].map((id) => (
          <option key={id} value={id}>
            {result.related[id]?.title || 'Untitled'}
          </option>
        ))}
      </select>
    )
  }
  const numeric = prop?.type === 'number' || (prop?.type === 'rollup' && prop.rollup?.function !== 'showValues')
  return (
    <input
      type={numeric ? 'number' : prop?.type === 'date' ? 'date' : 'text'}
      defaultValue={value == null ? '' : String(value)}
      placeholder="Value"
      onBlur={(e) => onChange(numeric ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function SortMenu({ result, at, onClose }: { result: DatabaseResult; at: Anchor; onClose: () => void }) {
  const view = result.view
  const update = (sorts: View['sorts']) => void setView(result.databaseId, { ...view, sorts })
  return (
    <Popover x={at.x} y={at.y} anchorTop={at.top} onClose={onClose} className="db-menu wide">
      <div className="db-form">
        <div className="menu-caption">Sort</div>
        {view.sorts.map((s, i) => (
          <div key={i} className="db-filter-row">
            <select value={s.property} onChange={(e) => update(view.sorts.map((x, j) => (j === i ? { ...x, property: e.target.value } : x)))}>
              {result.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="ghost-btn" onClick={() => update(view.sorts.map((x, j) => (j === i ? { ...x, desc: !x.desc } : x)))}>
              {s.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />} {s.desc ? 'Descending' : 'Ascending'}
            </button>
            <button className="icon-btn" aria-label="Remove sort" onClick={() => update(view.sorts.filter((_, j) => j !== i))}>
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="menu-item" onClick={() => update([...view.sorts, { property: TITLE, desc: false }])}>
          <Plus size={13} /> Add sort
        </button>
      </div>
    </Popover>
  )
}

/** Which columns the view shows (and for boards, what it groups by). */
export function ViewSettingsMenu({
  result,
  at,
  onClose,
  onDelete,
}: {
  result: DatabaseResult
  at: Anchor
  onClose: () => void
  onDelete?: () => void
}) {
  const view = result.view
  const db = result.databaseId
  const [name, setName] = useState(view.name)
  const hidden = view.hidden ?? []
  const selects = result.properties.filter((p) => p.type === 'select')
  const toggle = (id: string) =>
    void setView(db, { ...view, hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] })

  return (
    <Popover x={at.x} y={at.y} anchorTop={at.top} onClose={onClose} className="db-menu">
      <div className="db-form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== view.name && void setView(db, { ...view, name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {view.type === 'board' && (
          <label>
            Group by
            <select value={view.groupBy ?? ''} onChange={(e) => void setView(db, { ...view, groupBy: e.target.value || undefined })}>
              <option value="">Choose a Select column…</option>
              {selects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <DatabaseTemplateSetting result={result} />
        <div className="menu-caption">Columns</div>
        <div className="menu-list">
          {result.properties
            .filter((p) => p.id !== TITLE)
            .map((p) => (
              <label key={p.id} className="db-check-row">
                <input type="checkbox" checked={!hidden.includes(p.id)} onChange={() => toggle(p.id)} />
                <PropIcon type={p.type} /> {p.name}
              </label>
            ))}
        </div>
        {onDelete && (
          <>
            <div className="menu-sep" />
            <button className="menu-item danger" onClick={onDelete}>
              <span className="menu-icon">
                <Trash2 size={14} />
              </span>
              <span className="menu-label">Delete view</span>
            </button>
          </>
        )}
      </div>
    </Popover>
  )
}

export function OptionChip({ result, propId, optionId }: { result: DatabaseResult; propId: string; optionId: string | null }) {
  const opt = result.properties.find((p) => p.id === propId)?.options?.find((o) => o.id === optionId)
  return opt ? <Chip color={opt.color}>{opt.name}</Chip> : null
}

/** Database setting: the template new pages (rows) start from. */
function DatabaseTemplateSetting({ result }: { result: DatabaseResult }) {
  const pages = useApp((s) => s.pages)
  const templates = useMemo(() => listTemplates(), [pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = templateExists(result.template) ? result.template : ''
  return (
    <label>
      Template for new pages
      <select
        aria-label="Template for new pages"
        value={current}
        onChange={(e) => void setDatabaseTemplate(result.databaseId, e.target.value || null).catch((err) => toast(`Could not change it: ${err}`))}
      >
        <option value="">None (an empty page)</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.icon ? `${t.icon} ` : ''}
            {t.title || 'Untitled'}
          </option>
        ))}
      </select>
    </label>
  )
}
