import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Play, Plus, Settings2, Trash2, X } from 'lucide-react'
import type { ButtonBlockProps } from '@brainwaves/editor'
import { databaseDef } from '../database/api'
import type { Property } from '../database/types'
import type { Page } from '../lib/types'
import { toast, useApp } from '../state/store'
import { listTemplates } from '../templates/apply'
import { askedVars, runButton, settingsOf, type ButtonSettings, type Step, type TextStyle, type TextWhere, type Where } from './model'

const COLORS = ['', '#e5534b', '#f0883e', '#d4a72c', '#4caf7a', '#3fb7c4', '#4c8dff', '#9b6cff', '#e36bae', '#8b949e']
const VARIANTS: [ButtonSettings['variant'], string][] = [
  ['solid', 'Solid'],
  ['soft', 'Soft'],
  ['outline', 'Outline'],
  ['ghost', 'Plain'],
]
const STYLES: [TextStyle, string][] = [
  ['paragraph', 'Text'],
  ['todo', 'To-do'],
  ['bullet', 'Bullet'],
  ['heading', 'Heading'],
  ['quote', 'Quote'],
]

const newStep = (kind: Step['kind']): Step =>
  kind === 'createPage'
    ? { kind, where: { kind: 'here' }, title: 'Note {{date}}', open: 'tab' }
    : kind === 'addText'
      ? { kind, where: { kind: 'below' }, text: '{{date}} ', style: 'todo' }
      : { kind, url: '' }

/** Pages for a picker: not rows, not trashed, by title. */
function usePagesList() {
  const pages = useApp((s) => s.pages)
  return useMemo(() => {
    const all = Object.values(pages).filter((p) => p.trashedAt == null && !p.databaseId)
    const byTitle = (a: Page, b: Page) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled')
    return { pages: all.filter((p) => p.kind !== 'database').sort(byTitle), databases: all.filter((p) => p.kind === 'database').sort(byTitle) }
  }, [pages])
}

const label = (p: Page) => `${p.icon ? p.icon + ' ' : ''}${p.title || 'Untitled'}`

/** A button block: click it to run its steps; the gear edits its look and its steps. */
export function ButtonBlock({ settings: raw, editable, onSettings, insertBelow, pageId }: ButtonBlockProps & { pageId: string }) {
  const s = settingsOf(raw)
  const [editing, setEditing] = useState(!!s.edit && editable)
  const [asking, setAsking] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const vars = useMemo(() => askedVars(s), [raw]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (patch: Partial<ButtonSettings>) => onSettings({ ...s, ...patch, edit: undefined })

  useEffect(() => {
    // Opened once when inserted; don't reopen it next time.
    if (s.edit) save({})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (values: Record<string, string>) => {
    setBusy(true)
    try {
      toast(await runButton(s, { pageId, insertBelow }, values))
      setAsking(false)
      setAnswers({})
    } catch (e) {
      toast(`The button stopped: ${String(e).replace(/^Error:\s*/, '')}`)
    } finally {
      setBusy(false)
    }
  }
  const click = () => {
    if (busy) return
    if (vars.length) setAsking((a) => !a)
    else void go({})
  }

  return (
    <div className="bwb">
      <div className={`bwb-row ${s.width === 'full' ? 'full' : ''}`}>
        <button
          className={`bwb-btn v-${s.variant} ${s.width === 'full' ? 'full' : ''}`}
          style={s.color ? ({ '--bwb': s.color } as React.CSSProperties) : undefined}
          onClick={click}
          disabled={busy}
          title={s.steps.length ? undefined : 'This button has no steps yet: open its settings'}
        >
          {busy ? <Loader2 size={14} className="spin" /> : s.icon ? <span className="bwb-icon">{s.icon}</span> : null}
          <span>{s.label || 'Button'}</span>
        </button>
        {editable && (
          <button className={`moc-gear bwb-gear ${editing ? 'on' : ''}`} title="Button settings" aria-label="Button settings" onClick={() => setEditing((v) => !v)}>
            <Settings2 size={14} />
          </button>
        )}
      </div>

      {asking && (
        <form
          className="bwb-ask"
          onSubmit={(e) => {
            e.preventDefault()
            void go(Object.fromEntries(vars.map((v) => [v.name.toLowerCase(), answers[v.name.toLowerCase()] || v.default])))
          }}
        >
          {vars.map((v, i) => (
            <label key={v.name} className="sync-field">
              <span>{v.name}</span>
              {v.kind === 'choice' ? (
                <select value={answers[v.name.toLowerCase()] ?? v.default} onChange={(e) => setAnswers({ ...answers, [v.name.toLowerCase()]: e.target.value })}>
                  {!v.default && <option value="">—</option>}
                  {v.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus={i === 0}
                  type={v.kind === 'date' ? 'date' : v.kind === 'number' ? 'number' : 'text'}
                  placeholder={v.default}
                  value={answers[v.name.toLowerCase()] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [v.name.toLowerCase()]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className="sync-actions">
            <button type="submit" className="setting-action primary" disabled={busy}>
              <Play size={13} /> Run
            </button>
            <button type="button" className="setting-action" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {editing && editable && <ButtonEditor s={s} save={save} close={() => setEditing(false)} />}
    </div>
  )
}

function ButtonEditor({ s, save, close }: { s: ButtonSettings; save: (p: Partial<ButtonSettings>) => void; close: () => void }) {
  const setStep = (i: number, st: Step) => save({ steps: s.steps.map((x, j) => (j === i ? st : x)) })
  const move = (i: number, d: -1 | 1) => {
    const steps = [...s.steps]
    const j = i + d
    if (j < 0 || j >= steps.length) return
    ;[steps[i], steps[j]] = [steps[j], steps[i]]
    save({ steps })
  }
  return (
    <div className="bwb-settings">
      <div className="bwb-head">
        <strong>Button</strong>
        <button className="icon-button" aria-label="Close button settings" onClick={close}>
          <X size={14} />
        </button>
      </div>

      <div className="bwb-sec">Look</div>
      <div className="bwb-grid">
        <label>
          Label
          <input value={s.label} onChange={(e) => save({ label: e.target.value })} placeholder="Create quick note" />
        </label>
        <label>
          Icon
          <input className="bwb-emoji" value={s.icon} maxLength={4} onChange={(e) => save({ icon: e.target.value })} placeholder="📝" />
        </label>
      </div>
      <div className="bwb-colors" role="radiogroup" aria-label="Colour">
        {COLORS.map((c) => (
          <button key={c || 'accent'} className={`bwb-swatch ${s.color === c ? 'on' : ''}`} style={{ background: c || 'var(--accent)' }} title={c || 'Theme colour'} aria-label={c || 'Theme colour'} onClick={() => save({ color: c })} />
        ))}
        <label className="bwb-custom" title="Any colour">
          <input type="color" value={s.color || '#9b6cff'} onChange={(e) => save({ color: e.target.value })} />
        </label>
      </div>
      <div className="bwb-grid">
        <label>
          Style
          <select value={s.variant} onChange={(e) => save({ variant: e.target.value as ButtonSettings['variant'] })}>
            {VARIANTS.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Width
          <select value={s.width} onChange={(e) => save({ width: e.target.value as ButtonSettings['width'] })}>
            <option value="auto">Fits the label</option>
            <option value="full">Full width</option>
          </select>
        </label>
      </div>

      <div className="bwb-sec">When clicked</div>
      {s.steps.length === 0 && <p className="bwb-hint">No steps yet. Add what the button should do.</p>}
      {s.steps.map((st, i) => (
        <div key={i} className="bwb-step">
          <div className="bwb-step-head">
            <span className="bwb-step-n">{i + 1}</span>
            <select aria-label="What to do" value={st.kind} onChange={(e) => setStep(i, newStep(e.target.value as Step['kind']))}>
              <option value="createPage">Create a page</option>
              <option value="addText">Add text or a to-do</option>
              <option value="open">Open a page or link</option>
            </select>
            <span className="bwb-step-tools">
              <button className="row-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={13} />
              </button>
              <button className="row-btn" aria-label="Move down" disabled={i === s.steps.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={13} />
              </button>
              <button className="row-btn danger" aria-label="Remove step" onClick={() => save({ steps: s.steps.filter((_, j) => j !== i) })}>
                <Trash2 size={13} />
              </button>
            </span>
          </div>
          {st.kind === 'createPage' && <CreatePageStep st={st} set={(x) => setStep(i, x)} />}
          {st.kind === 'addText' && <AddTextStep st={st} set={(x) => setStep(i, x)} />}
          {st.kind === 'open' && <OpenStep st={st} set={(x) => setStep(i, x)} />}
        </div>
      ))}
      <div className="bwb-add">
        <button className="setting-action" onClick={() => save({ steps: [...s.steps, newStep('createPage')] })}>
          <Plus size={13} /> Create a page
        </button>
        <button className="setting-action" onClick={() => save({ steps: [...s.steps, newStep('addText')] })}>
          <Plus size={13} /> Add text
        </button>
        <button className="setting-action" onClick={() => save({ steps: [...s.steps, newStep('open')] })}>
          <Plus size={13} /> Open
        </button>
      </div>

      <label className="bwb-wide">
        Message when done
        <input value={s.done ?? ''} onChange={(e) => save({ done: e.target.value })} placeholder="Leave empty for a short summary" />
      </label>
      <p className="bwb-hint">
        Texts can use fields: <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code>, <code>{'{{title}}'}</code> (this page), <code>{'{{date:dddd D MMMM}}'}</code>. Any other field, like{' '}
        <code>{'{{Topic}}'}</code> or <code>{'{{Priority: Low | High}}'}</code>, is asked when you click.
      </p>
    </div>
  )
}

type CreateStep = Extract<Step, { kind: 'createPage' }>

function CreatePageStep({ st, set }: { st: CreateStep; set: (s: Step) => void }) {
  const { pages, databases } = usePagesList()
  const all = useApp((x) => x.pages)
  const templates = useMemo(() => listTemplates(), [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const w = st.where ?? { kind: 'here' }
  const whereValue = w.kind === 'page' ? `page:${w.pageId}` : w.kind === 'database' ? `db:${w.databaseId}` : w.kind
  const setWhere = (v: string): Where =>
    v.startsWith('page:') ? { kind: 'page', pageId: v.slice(5) } : v.startsWith('db:') ? { kind: 'database', databaseId: v.slice(3) } : ({ kind: v } as Where)
  return (
    <div className="bwb-fields">
      <label>
        Where
        <select value={whereValue} onChange={(e) => set({ ...st, where: setWhere(e.target.value), values: {}, template: undefined })}>
          <option value="here">Under this page</option>
          <option value="top">At the top level</option>
          <optgroup label="Under a page">
            {pages.map((p) => (
              <option key={p.id} value={`page:${p.id}`}>
                {label(p)}
              </option>
            ))}
          </optgroup>
          {databases.length > 0 && (
            <optgroup label="As a row of a database">
              {databases.map((p) => (
                <option key={p.id} value={`db:${p.id}`}>
                  {label(p)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label>
        Title
        <input value={st.title} onChange={(e) => set({ ...st, title: e.target.value })} placeholder="Note {{date}}" />
      </label>
      <label>
        Template
        <select value={st.template ?? ''} onChange={(e) => set({ ...st, template: e.target.value || undefined })}>
          {w.kind === 'database' ? (
            <>
              <option value="">The database’s own template</option>
              <option value="none">None</option>
            </>
          ) : (
            <option value="">None</option>
          )}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {label(t)}
            </option>
          ))}
        </select>
      </label>
      {w.kind === 'database' ? (
        <RowValues databaseId={w.databaseId} values={st.values ?? {}} set={(values) => set({ ...st, values })} />
      ) : (
        <div className="bwb-grid">
          <label>
            Icon
            <input className="bwb-emoji" value={st.icon ?? ''} maxLength={4} onChange={(e) => set({ ...st, icon: e.target.value })} placeholder="📄" />
          </label>
          <label>
            Tags
            <input value={st.tags ?? ''} onChange={(e) => set({ ...st, tags: e.target.value })} placeholder="inbox, idea" />
          </label>
        </div>
      )}
      <label>
        Then
        <select value={st.open ?? 'tab'} onChange={(e) => set({ ...st, open: e.target.value as CreateStep['open'] })}>
          <option value="tab">Open it in a new tab</option>
          <option value="replace">Open it here</option>
          <option value="none">Don’t open it</option>
        </select>
      </label>
    </div>
  )
}

/** Values for the new row's columns (simple column types). */
function RowValues({ databaseId, values, set }: { databaseId: string; values: Record<string, unknown>; set: (v: Record<string, unknown>) => void }) {
  const [props, setProps] = useState<Property[] | null>(null)
  useEffect(() => {
    let live = true
    databaseDef(databaseId).then(
      (d) => live && setProps(d.properties.filter((p) => ['text', 'number', 'url', 'select', 'multiSelect', 'checkbox', 'date'].includes(p.type))),
      () => live && setProps([]),
    )
    return () => {
      live = false
    }
  }, [databaseId])
  if (!props) return <p className="bwb-hint">Reading the columns…</p>
  if (!props.length) return null
  const put = (id: string, v: unknown) => set({ ...values, [id]: v })
  return (
    <div className="bwb-values">
      <div className="bwb-sub">Values</div>
      {props.map((p) => {
        const v = values[p.id]
        return (
          <label key={p.id} className="bwb-value">
            <span>{p.name}</span>
            {p.type === 'select' || p.type === 'multiSelect' ? (
              <select value={String((Array.isArray(v) ? v[0] : v) ?? '')} onChange={(e) => put(p.id, e.target.value ? (p.type === 'multiSelect' ? [e.target.value] : e.target.value) : '')}>
                <option value="">—</option>
                {(p.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : p.type === 'checkbox' ? (
              <input type="checkbox" checked={v === true} onChange={(e) => put(p.id, e.target.checked || '')} />
            ) : p.type === 'date' ? (
              <select value={String(v ?? '')} onChange={(e) => put(p.id, e.target.value)}>
                <option value="">—</option>
                <option value="{{date}}">Today</option>
                <option value="{{tomorrow}}">Tomorrow</option>
                <option value="{{date+7}}">In a week</option>
              </select>
            ) : (
              <input value={String(v ?? '')} onChange={(e) => put(p.id, p.type === 'number' && e.target.value && !e.target.value.includes('{{') ? Number(e.target.value) : e.target.value)} placeholder="—" />
            )}
          </label>
        )
      })}
    </div>
  )
}

type TextStep = Extract<Step, { kind: 'addText' }>

function AddTextStep({ st, set }: { st: TextStep; set: (s: Step) => void }) {
  const { pages } = usePagesList()
  const w = st.where ?? { kind: 'below' }
  const whereValue = w.kind === 'page' ? `page:${w.pageId}` : w.kind
  const setWhere = (v: string): TextWhere => (v.startsWith('page:') ? { kind: 'page', pageId: v.slice(5), position: 'bottom' } : v === 'created' ? { kind: 'created', position: 'bottom' } : { kind: 'below' })
  return (
    <div className="bwb-fields">
      <label>
        Where
        <select value={whereValue} onChange={(e) => set({ ...st, where: setWhere(e.target.value) })}>
          <option value="below">Under this button</option>
          <option value="created">In the page an earlier step made</option>
          <optgroup label="In a page">
            {pages.map((p) => (
              <option key={p.id} value={`page:${p.id}`}>
                {label(p)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {w.kind !== 'below' && (
        <label>
          Position
          <select value={w.position ?? 'bottom'} onChange={(e) => set({ ...st, where: { ...w, position: e.target.value as 'top' | 'bottom' } as TextWhere })}>
            <option value="bottom">At the end</option>
            <option value="top">At the start</option>
          </select>
        </label>
      )}
      <div className="bwb-grid">
        <label>
          As
          <select value={st.style ?? 'paragraph'} onChange={(e) => set({ ...st, style: e.target.value as TextStyle })}>
            {STYLES.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Text
          <input value={st.text} onChange={(e) => set({ ...st, text: e.target.value })} placeholder="{{time}} " />
        </label>
      </div>
    </div>
  )
}

type OpenStepT = Extract<Step, { kind: 'open' }>

function OpenStep({ st, set }: { st: OpenStepT; set: (s: Step) => void }) {
  const { pages, databases } = usePagesList()
  return (
    <div className="bwb-fields">
      <label>
        Page
        <select value={st.pageId ?? ''} onChange={(e) => set({ ...st, pageId: e.target.value || undefined })}>
          <option value="">— (or a link below)</option>
          {[...pages, ...databases].map((p) => (
            <option key={p.id} value={p.id}>
              {label(p)}
            </option>
          ))}
        </select>
      </label>
      {!st.pageId && (
        <label>
          Link
          <input value={st.url ?? ''} onChange={(e) => set({ ...st, url: e.target.value })} placeholder="https://…" />
        </label>
      )}
    </div>
  )
}
