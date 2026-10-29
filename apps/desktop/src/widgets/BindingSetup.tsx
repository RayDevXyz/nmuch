import { Blocks, Lock, PenLine, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { databaseDef, setProperty } from '../database/api'
import { PropIcon } from '../database/cells'
import { TYPE_LABEL, type PropType, type Property } from '../database/types'
import { coreClient } from '../lib/storage'
import { createPage } from '../state/actions'
import { useApp } from '../state/store'
import type { Binding, FieldSpec, Manifest, SlotSpec } from './api'

/** Column types a new database can be given for a field (relations and rollups need a target). */
const CREATABLE: PropType[] = ['checkbox', 'number', 'select', 'multiSelect', 'date', 'text', 'url', 'file']

/**
 * Connect each slot of a widget to a database, and each field the slot needs to a column of
 * a fitting type. This is the whole of what the widget will be able to see or change.
 */
export function BindingSetup({
  manifest,
  pageId,
  bindings,
  onSave,
  onCancel,
}: {
  manifest: Manifest
  pageId: string
  bindings: Record<string, Binding>
  onSave(b: Record<string, Binding>): void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<Record<string, Binding>>(() => structuredClone(bindings ?? {}))
  const pages = useApp((s) => s.pages)
  const databases = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.kind === 'database' && p.trashedAt == null)
        .sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled')),
    [pages],
  )
  const slots = Object.entries(manifest.slots)
  const complete = slots.every(([k, s]) => {
    const b = draft[k]
    return !!b?.databaseId && Object.entries(s.fields).every(([f, spec]) => spec.optional || !!b.fields?.[f])
  })

  return (
    <div className="widget-setup">
      <div className="widget-setup-head">
        {manifest.icon ? <span className="widget-setup-icon">{manifest.icon}</span> : <Blocks size={16} />}
        <div>
          <div className="widget-setup-title">{manifest.name}</div>
          {manifest.description && <div className="widget-setup-desc">{manifest.description}</div>}
        </div>
      </div>
      {slots.length === 0 && <div className="widget-setup-desc">This widget doesn't use any databases.</div>}
      {slots.map(([key, spec]) => (
        <SlotSetup
          key={key}
          slot={key}
          spec={spec}
          pageId={pageId}
          databases={databases}
          binding={draft[key]}
          onChange={(b) => setDraft((d) => ({ ...d, [key]: b }))}
        />
      ))}
      <div className="db-form-actions">
        {onCancel && (
          <button className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary-btn" disabled={!complete} onClick={() => onSave(draft)}>
          {onCancel ? 'Save' : 'Connect'}
        </button>
      </div>
    </div>
  )
}

function SlotSetup({
  slot,
  spec,
  pageId,
  databases,
  binding,
  onChange,
}: {
  slot: string
  spec: SlotSpec
  pageId: string
  databases: { id: string; title: string; icon: string }[]
  binding: Binding | undefined
  onChange(b: Binding): void
}) {
  const dbId = binding?.databaseId ?? ''
  const [columns, setColumns] = useState<Property[] | null>(null)
  const [busy, setBusy] = useState(false)
  // Databases that have a fitting column for every required field.
  const [fitting, setFitting] = useState<string[] | null>(null)

  // Re-checked when data changes while nothing is picked yet (a course tracker created in the
  // meantime gets its columns just after its database pages appear).
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (dbId) return
    let t: ReturnType<typeof setTimeout> | undefined
    const off = coreClient().onEvent(() => {
      clearTimeout(t)
      t = setTimeout(() => setTick((n) => n + 1), 400)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [dbId])
  const dbKey = databases.map((d) => d.id).join(',') + ':' + tick
  useEffect(() => {
    let live = true
    const required = Object.entries(spec.fields).filter(([, f]) => !f.optional)
    const named = (key: string, f: FieldSpec, p: Property) => [key, f.label].some((n) => n && p.name.toLowerCase() === n.toLowerCase())
    void Promise.all(
      databases.map((d) =>
        databaseDef(d.id).then(
          (def) => {
            const fits = required.every(([, f]) => def.properties.some((p) => f.types.includes(p.type)))
            const byName = fits && required.every(([k, f]) => def.properties.some((p) => f.types.includes(p.type) && named(k, f, p)))
            return fits ? { id: d.id, byName } : null
          },
          () => null,
        ),
      ),
    ).then((found) => {
      if (!live) return
      const fit = found.filter((x): x is { id: string; byName: boolean } => !!x)
      setFitting(fit.map((f) => f.id))
      // One database fits, or one has columns with the very names asked for: that's the one.
      const named = fit.filter((f) => f.byName)
      const pick = fit.length === 1 ? fit[0] : named.length === 1 ? named[0] : null
      if (!dbId && pick) onChange({ databaseId: pick.id, fields: {} })
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbKey])

  useEffect(() => {
    let live = true
    setColumns(null)
    if (dbId) void databaseDef(dbId).then((d) => live && setColumns(d.properties), () => live && setColumns([]))
    return () => {
      live = false
    }
  }, [dbId])

  // Fill fields that have an obvious column (same name, or the only one of a fitting type).
  useEffect(() => {
    if (!columns || !binding) return
    const fields = { ...binding.fields }
    let changed = false
    for (const [key, f] of Object.entries(spec.fields)) {
      if (fields[key] && columns.some((c) => c.id === fields[key] && f.types.includes(c.type))) continue
      const fit = columns.filter((c) => f.types.includes(c.type))
      const named = fit.find((c) => [key, f.label].some((n) => n && c.name.toLowerCase() === n.toLowerCase()))
      const pick = named ?? (fit.length === 1 ? fit[0] : undefined)
      if (pick) {
        fields[key] = pick.id
        changed = true
      } else if (fields[key]) {
        delete fields[key]
        changed = true
      }
    }
    if (changed) onChange({ ...binding, fields })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns])

  const createDatabase = async () => {
    setBusy(true)
    try {
      const db = await createPage({ kind: 'database', title: spec.label || slot, parentId: pageId, open: false })
      const fields: Record<string, string> = {}
      for (const [key, f] of Object.entries(spec.fields)) {
        const type = f.types.find((t) => CREATABLE.includes(t))
        if (!type) continue
        await setProperty(db.id, { id: key, name: f.label || key, type })
        fields[key] = key
      }
      onChange({ databaseId: db.id, fields })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="widget-slot">
      <div className="widget-slot-head">
        <span className="widget-slot-name">{spec.label || slot}</span>
        <span className={`widget-access ${spec.access}`} title={spec.access === 'write' ? 'Can add and change rows' : 'Can only read'}>
          {spec.access === 'write' ? <PenLine size={11} /> : <Lock size={11} />}
          {spec.access === 'write' ? 'read & write' : 'read only'}
        </span>
      </div>
      {spec.description && <div className="widget-setup-desc">{spec.description}</div>}
      {fitting && fitting.length === 0 && (
        <div className="widget-hint">
          None of your databases has the columns this needs yet. Use <strong>New</strong> to make one, or add the columns to a database.
        </div>
      )}
      <div className="widget-field">
        <span className="widget-field-label">Database</span>
        <select value={dbId} onChange={(e) => onChange({ databaseId: e.target.value, fields: {} })}>
          <option value="">Choose a database…</option>
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon ? d.icon + ' ' : ''}
              {d.title || 'Untitled'}
            </option>
          ))}
        </select>
        <button className="ghost-btn" disabled={busy} onClick={() => void createDatabase()} title="Create a database with the columns this widget needs">
          <Plus size={13} /> New
        </button>
      </div>
      {dbId &&
        Object.entries(spec.fields).map(([key, f]) => {
          const fit = (columns ?? []).filter((c) => f.types.includes(c.type))
          return (
            <div className="widget-field" key={key}>
              <span className="widget-field-label">
                {f.label || key}
                {f.optional && <em> optional</em>}
              </span>
              <select
                value={binding?.fields?.[key] ?? ''}
                onChange={(e) => {
                  const fields = { ...binding?.fields }
                  if (e.target.value) fields[key] = e.target.value
                  else delete fields[key]
                  onChange({ databaseId: dbId, fields })
                }}
              >
                <option value="">{fit.length ? (f.optional ? 'Not used' : 'Choose a column…') : `No ${f.types.map((t) => TYPE_LABEL[t]).join(' / ')} column`}</option>
                {fit.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="widget-field-types">
                {f.types.map((t) => (
                  <PropIcon key={t} type={t} size={12} />
                ))}
              </span>
            </div>
          )
        })}
    </div>
  )
}
