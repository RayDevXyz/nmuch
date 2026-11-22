import { ArrowDown, ArrowUp, Eye, EyeOff, ExternalLink, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { Popover } from '../components/Popover'
import { Chip, PropIcon } from '../database/cells'
import { COLORS } from '../database/types'
import { db, openExternal } from '../lib/storage'
import { addProp, moveProp, PROP_TYPES, removeProp, setShowProps, updateProp, usePageProps, type PageProp, type PagePropType } from './model'

const colorOf = (p: PageProp, v: string) => COLORS[Math.max(0, (p.options ?? []).indexOf(v)) % COLORS.length]

/** A text box that saves on Enter or when it loses focus, and follows changes made elsewhere. */
function Field({ value, onCommit, type = 'text', placeholder, className }: { value: string; onCommit: (v: string) => void; type?: string; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setV(value)
  }, [value])
  const commit = () => v !== value && onCommit(v)
  return (
    <input
      className={`pp-input ${className ?? ''}`}
      type={type}
      value={v}
      placeholder={placeholder ?? 'Empty'}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setV(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

function Choices({ doc, p }: { doc: Y.Doc; p: PageProp }) {
  const multi = p.type === 'multiSelect'
  const vals = (Array.isArray(p.value) ? p.value : p.value ? [p.value] : []) as string[]
  const [text, setText] = useState('')
  const listId = `pp-opts-${p.id}`
  const add = (raw: string) => {
    const t = raw.trim()
    setText('')
    if (!t) return
    updateProp(doc, p.id, { value: multi ? [...new Set([...vals, t])] : t })
  }
  // A "Tags" property is the page's tags: suggest the workspace's tags too.
  const isTags = /^tags?$/i.test(p.name.trim())
  const [known, setKnown] = useState<string[]>([])
  useEffect(() => {
    if (isTags) db().tags().then((ts) => setKnown(ts.map((t) => t.tag)), () => {})
  }, [isTags])
  const unused = [...new Set([...(p.options ?? []), ...known])].filter((o) => !vals.some((v) => v.toLowerCase() === o.toLowerCase()))
  return (
    <div className="pp-choices">
      {vals.map((v) => (
        <Chip key={v} color={colorOf(p, v)} onRemove={() => updateProp(doc, p.id, { value: multi ? vals.filter((x) => x !== v) : '' })}>
          {v}
        </Chip>
      ))}
      {(multi || vals.length === 0) && (
        <>
          <input
            className="pp-input pp-choice-input"
            list={listId}
            value={text}
            placeholder={vals.length ? 'Add…' : 'Choose or type…'}
            onChange={(e) => {
              const t = e.target.value
              // Picking from the suggestions fills the box with an exact choice: take it at once.
              if (unused.includes(t) && t !== text) return add(t)
              setText(t)
            }}
            onKeyDown={(e) => e.key === 'Enter' && add(text)}
            onBlur={() => add(text)}
          />
          <datalist id={listId}>
            {unused.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </>
      )}
    </div>
  )
}

function Value({ doc, p }: { doc: Y.Doc; p: PageProp }) {
  const set = (value: unknown) => updateProp(doc, p.id, { value })
  switch (p.type) {
    case 'checkbox':
      return <input className="pp-check" type="checkbox" checked={p.value === true} onChange={(e) => set(e.target.checked)} />
    case 'number':
      return <Field type="number" value={p.value == null ? '' : String(p.value)} onCommit={(v) => set(v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v))} />
    case 'date':
      return <input className="pp-input" type="date" value={typeof p.value === 'string' ? p.value : ''} onChange={(e) => set(e.target.value)} />
    case 'select':
    case 'multiSelect':
      return <Choices doc={doc} p={p} />
    case 'url': {
      const v = typeof p.value === 'string' ? p.value : ''
      return (
        <div className="pp-url">
          <Field value={v} placeholder="https://…" onCommit={(x) => set(x.trim() && !/^[a-z]+:/i.test(x.trim()) ? `https://${x.trim()}` : x.trim())} />
          {v && (
            <button className="pp-icon-btn" title="Open the link" aria-label="Open the link" onClick={() => openExternal(v)}>
              <ExternalLink size={13} />
            </button>
          )}
        </div>
      )
    }
    default:
      return <Field value={typeof p.value === 'string' ? p.value : p.value == null ? '' : String(p.value)} onCommit={set} />
  }
}

function Row({ doc, p, first, last }: { doc: Y.Doc; p: PageProp; first: boolean; last: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`pp-row ${open ? 'open' : ''}`} data-prop={p.name}>
      <div className="pp-main">
        <button className="pp-label" title="Rename, change type, move or delete" onClick={() => setOpen((o) => !o)}>
          <PropIcon type={p.type} />
          <span>{p.name || 'Untitled'}</span>
          <MoreHorizontal size={13} className="pp-more" />
        </button>
        <div className="pp-value">
          <Value doc={doc} p={p} />
        </div>
      </div>
      {open && (
        <div className="pp-settings">
          <Field className="pp-name" value={p.name} placeholder="Name" onCommit={(name) => name.trim() && updateProp(doc, p.id, { name: name.trim() })} />
          <select className="pp-input pp-type" value={p.type} onChange={(e) => updateProp(doc, p.id, { type: e.target.value as PagePropType })} aria-label="Type">
            {PROP_TYPES.map(([t, label]) => (
              <option key={t} value={t}>
                {label}
              </option>
            ))}
          </select>
          <button className="pp-icon-btn" disabled={first} title="Move up" aria-label="Move up" onClick={() => moveProp(doc, p.id, -1)}>
            <ArrowUp size={13} />
          </button>
          <button className="pp-icon-btn" disabled={last} title="Move down" aria-label="Move down" onClick={() => moveProp(doc, p.id, 1)}>
            <ArrowDown size={13} />
          </button>
          <button className="pp-icon-btn danger" title="Delete the property" aria-label="Delete the property" onClick={() => removeProp(doc, p.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function AddProp({ doc }: { doc: Y.Doc }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<PagePropType>('text')
  if (!adding)
    return (
      <button className="pp-add" onClick={() => setAdding(true)}>
        <Plus size={13} /> Add property
      </button>
    )
  const go = () => {
    if (name.trim()) addProp(doc, name.trim(), type)
    setName('')
    setType('text')
    setAdding(false)
  }
  return (
    <form
      className="pp-new"
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      <input className="pp-input" autoFocus placeholder="Property name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
      <div className="pp-types" role="radiogroup" aria-label="Type">
        {PROP_TYPES.map(([t, label]) => (
          <button type="button" key={t} role="radio" aria-checked={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
            <PropIcon type={t} /> {label}
          </button>
        ))}
      </div>
      <div className="pp-new-actions">
        <button type="button" className="pp-btn" onClick={() => setAdding(false)}>
          Cancel
        </button>
        <button type="submit" className="pp-btn primary" disabled={!name.trim()}>
          Add
        </button>
      </div>
    </form>
  )
}

function List({ doc, props }: { doc: Y.Doc; props: PageProp[] }) {
  return (
    <div className="pp-list">
      {props.map((p, i) => (
        <Row key={p.id} doc={doc} p={p} first={i === 0} last={i === props.length - 1} />
      ))}
    </div>
  )
}

/**
 * The "Properties" button by the title. It opens the properties in a pop-up; "Show on page"
 * lists them under the title instead (they stay editable there).
 */
export function PagePropsButton({ doc }: { doc: Y.Doc }) {
  const { props, show } = usePageProps(doc)
  const [at, setAt] = useState<DOMRect | null>(null)
  return (
    <>
      <button className="page-prop" title="Properties of this page" onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())}>
        <SlidersHorizontal size={13} /> Properties{props.length ? <span className="pp-count">{props.length}</span> : null}
      </button>
      {at && (
        <Popover x={at.left} y={at.bottom} anchorTop={at.top} onClose={() => setAt(null)} className="pp-pop">
          <div className="pp-head">
            <b>Properties</b>
            <button className={`pp-show ${show ? 'on' : ''}`} onClick={() => setShowProps(doc, !show)} title={show ? 'Only in this pop-up' : 'List them under the title'}>
              {show ? <Eye size={13} /> : <EyeOff size={13} />} {show ? 'Shown on page' : 'Show on page'}
            </button>
          </div>
          {props.length === 0 && <div className="pp-empty">No properties yet. Add a status, a date, tags, a link…</div>}
          <List doc={doc} props={props} />
          <AddProp doc={doc} />
        </Popover>
      )}
    </>
  )
}

/** The properties under the title, when "Show on page" is on. */
export function PagePropsInline({ doc }: { doc: Y.Doc }) {
  const { props, show } = usePageProps(doc)
  if (!show || props.length === 0) return null
  return (
    <div className="pp-inline">
      <List doc={doc} props={props} />
      <div className="pp-inline-foot">
        <AddProp doc={doc} />
        <button className="pp-hide" title="Keep them in the Properties pop-up only" onClick={() => setShowProps(doc, false)}>
          <EyeOff size={12} /> Hide
        </button>
      </div>
    </div>
  )
}
