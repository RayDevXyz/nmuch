import { useEffect, useMemo, useState } from 'react'
import { Archive, Check, Rocket, Search, X } from 'lucide-react'
import { queryDatabase } from '../database/api'
import { toast, useApp } from '../state/store'
import { openPage } from '../state/actions'
import { applyParaTemplate } from './templates'
import { message, openParaDialog, paraArchive, paraProcess, paraPromote, REASONS, STATUSES, useParaDialog, type Space } from './api'

interface Item {
  id: string
  title: string
  icon: string
}

/** The live (not archived) rows of a database, by title. */
function useRows(databaseId: string | undefined): Item[] {
  const [rows, setRows] = useState<Item[]>([])
  useEffect(() => {
    if (!databaseId) return
    let live = true
    queryDatabase(databaseId, undefined, {
      id: '',
      name: '',
      type: 'table',
      order: '',
      filters: [{ property: 'archived', op: 'is', value: false }],
      sorts: [{ property: 'title', desc: false }],
    }).then(
      (r) => live && setRows(r.rows.map((x) => ({ id: x.id, title: x.title || 'Untitled', icon: x.icon }))),
      () => live && setRows([]),
    )
    return () => {
      live = false
    }
  }, [databaseId])
  return rows
}

function Shell({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const close = () => openParaDialog(null)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="account tpl-dialog para-dialog" role="dialog" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header>
          <span>
            {icon} {title}
          </span>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <section>{children}</section>
      </div>
    </div>
  )
}

function PromoteDialog({ rowId, space }: { rowId: string; space: Space }) {
  const note = useApp((s) => s.pages[rowId])
  const areas = useRows(space.areas)
  const [f, setF] = useState({ status: 'not_started', deadline: '', area: '', outcome: '', nextAction: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const ready = f.outcome.trim() && f.nextAction.trim()
  const go = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      await paraPromote(rowId, { ...f, area: f.area || undefined, deadline: f.deadline || undefined })
      // The project template goes below what the note already says.
      await applyParaTemplate(space, 'projects', rowId, true).catch((e) => console.error('PARA template:', e))
      openParaDialog(null)
      toast(`“${note?.title || 'Untitled'}” is a project now`)
      openPage(rowId, 'replace')
    } catch (e) {
      toast(`Could not promote: ${message(e)}`)
      setBusy(false)
    }
  }
  return (
    <Shell title="Promote to project" icon={<Rocket size={15} />}>
      <p className="account-hint">
        <b>{note?.title || 'Untitled'}</b> moves from the Inbox to Projects. Its content, links and tags come along.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        <label className="sync-field">
          <span>Outcome *</span>
          <input autoFocus placeholder="What does done look like?" value={f.outcome} onChange={set('outcome')} />
        </label>
        <label className="sync-field">
          <span>Next action *</span>
          <input placeholder="The very next physical step" value={f.nextAction} onChange={set('nextAction')} />
        </label>
        <div className="para-row2">
          <label className="sync-field">
            <span>Deadline</span>
            <input type="date" value={f.deadline} onChange={set('deadline')} />
          </label>
          <label className="sync-field">
            <span>Status</span>
            <select value={f.status} onChange={set('status')}>
              {STATUSES.slice(0, 3).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="sync-field">
          <span>Area</span>
          <select value={f.area} onChange={set('area')}>
            <option value="">{areas.length ? 'The note’s first linked area (if any)' : 'No areas yet'}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon ? `${a.icon} ` : ''}
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <div className="sync-actions">
          <button className="primary-btn" type="submit" disabled={!ready || busy}>
            <Rocket size={14} /> Promote
          </button>
        </div>
      </form>
    </Shell>
  )
}

function ProcessDialog({ rowId, space }: { rowId: string; space: Space }) {
  const note = useApp((s) => s.pages[rowId])
  const projects = useRows(space.projects)
  const areas = useRows(space.areas)
  const resources = useRows(space.resources)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = useMemo(() => {
    const match = (i: Item) => !q || i.title.toLowerCase().includes(q.toLowerCase())
    return [
      { key: 'projects', name: 'Projects', items: projects.filter(match) },
      { key: 'areas', name: 'Areas', items: areas.filter(match) },
      { key: 'resources', name: 'Resources', items: resources.filter(match) },
    ] as const
  }, [projects, areas, resources, q])
  const toggle = (id: string) => {
    const n = new Set(picked)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setPicked(n)
  }
  const go = async () => {
    setBusy(true)
    const of = (items: Item[]) => items.filter((i) => picked.has(i.id)).map((i) => i.id)
    try {
      await paraProcess(rowId, { projects: of(projects), areas: of(areas), resources: of(resources) })
      openParaDialog(null)
      toast(`Processed “${note?.title || 'Untitled'}”`)
    } catch (e) {
      toast(`Could not process: ${message(e)}`)
      setBusy(false)
    }
  }
  const empty = !projects.length && !areas.length && !resources.length
  return (
    <Shell title="Link & process" icon={<Check size={15} />}>
      <p className="account-hint">
        Link <b>{note?.title || 'Untitled'}</b> to what it belongs to. It leaves the Inbox and shows up on each of them as a note.
      </p>
      {empty ? (
        <p className="account-hint">There are no projects, areas or resources yet: you can still mark the note processed.</p>
      ) : (
        <label className="tpl-search">
          <Search size={14} />
          <input autoFocus placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      <div className="para-pick">
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.key}>
                <h4>{g.name}</h4>
                {g.items.map((i) => (
                  <label key={i.id} className={picked.has(i.id) ? 'on' : ''}>
                    <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                    <span>
                      {i.icon ? `${i.icon} ` : ''}
                      {i.title}
                    </span>
                  </label>
                ))}
              </div>
            ),
        )}
      </div>
      <div className="sync-actions">
        <button className="primary-btn" disabled={busy} onClick={() => void go()}>
          <Check size={14} /> {picked.size ? `Link ${picked.size} & process` : 'Mark processed'}
        </button>
      </div>
    </Shell>
  )
}

function ArchiveDialog({ rowId, role }: { rowId: string; role: string }) {
  const row = useApp((s) => s.pages[rowId])
  const [reason, setReason] = useState(role === 'projects' ? 'completed' : role === 'resources' ? 'deprecated' : 'on_ice')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await paraArchive(rowId, reason)
      openParaDialog(null)
      toast(`Archived “${row?.title || 'Untitled'}”`)
    } catch (e) {
      toast(`Could not archive: ${message(e)}`)
      setBusy(false)
    }
  }
  return (
    <Shell title="Archive" icon={<Archive size={15} />}>
      <p className="account-hint">
        <b>{row?.title || 'Untitled'}</b> leaves the lists and the sidebar. Links and backlinks to it stay, shown muted. Restore it from the Archive at any time.
      </p>
      <div className="sync-modes para-reasons">
        {REASONS.map(([id, name]) => (
          <label key={id} className={reason === id ? 'on' : ''}>
            <input type="radio" name="reason" checked={reason === id} onChange={() => setReason(id)} />
            <span>{name}</span>
          </label>
        ))}
      </div>
      <div className="sync-actions">
        <button className="primary-btn" disabled={busy} onClick={() => void go()} autoFocus>
          <Archive size={14} /> Archive
        </button>
      </div>
    </Shell>
  )
}

export function ParaDialogs() {
  const d = useParaDialog()
  if (!d) return null
  if (d.kind === 'promote') return <PromoteDialog key={d.rowId} rowId={d.rowId} space={d.space} />
  if (d.kind === 'process') return <ProcessDialog key={d.rowId} rowId={d.rowId} space={d.space} />
  return <ArchiveDialog key={d.rowId} rowId={d.rowId} role={d.role} />
}
