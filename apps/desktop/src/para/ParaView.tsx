import { useEffect, useState } from 'react'
import { ensureParaTemplates, linkParaTemplates } from './templates'
import { applyDatabaseTemplate } from '../templates/apply'
import { Archive, ArchiveRestore, CalendarCheck, Check, Inbox, Rocket } from 'lucide-react'
import { createRow } from '../database/api'
import { uid } from '../lib/id'
import { getState, toast, useApp } from '../state/store'
import { openPage, setView } from '../state/actions'
import { askView, dueText, HEALTH, message, openParaDialog, paraReviewed, paraSetup, paraUnarchive, REASONS, useOverview, useSpaces, type ParaRole, type Space } from './api'

const reasonName = Object.fromEntries(REASONS)
const KIND_ICON: Record<string, string> = { note: '📥', project: '🚀', area: '🧭', resource: '📚' }

/** The view each database opens on (its first). */
const MAIN: Record<ParaRole, string> = { inbox: 'Inbox', projects: 'Active projects', areas: 'Areas dashboard', resources: 'Library' }

/** Open a database of the space on one of its saved views. */
export function openRole(space: Space, role: ParaRole, viewName?: string, mode: 'replace' | 'tab' = 'replace') {
  openPage(space[role], mode)
  askView(space[role], space.views[role]?.[viewName ?? MAIN[role]])
}

/** Open a page as soon as the app has heard of it (just after it was made on the server). */
function openWhenKnown(id: string, tries = 40) {
  if (getState().pages[id]) return openPage(id, 'replace')
  if (tries > 0) setTimeout(() => openWhenKnown(id, tries - 1), 100)
}

function Setup() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="para-setup">
      <div className="para-setup-icon">🗂️</div>
      <strong>Organise with PARA</strong>
      <p>
        Capture everything into an <b>Inbox</b>, then sort it into <b>Projects</b> (with a deadline and an outcome), <b>Areas</b> (standards you keep up),{' '}
        <b>Resources</b> (topics of interest) and the <b>Archive</b>.
      </p>
      <button
        className="primary-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const s = await paraSetup(null)
            await ensureParaTemplates(s).catch(() => {})
            openWhenKnown(s.hub)
            toast('PARA is set up')
          } catch (e) {
            toast(`Could not set up PARA: ${message(e)}`)
          } finally {
            setBusy(false)
          }
        }}
      >
        Set up PARA
      </button>
    </div>
  )
}

function Capture({ space }: { space: Space }) {
  const [text, setText] = useState('')
  return (
    <form
      className="para-capture"
      onSubmit={async (e) => {
        e.preventDefault()
        const title = text.trim()
        if (!title) return
        setText('')
        try {
          const id = uid()
          await createRow(space.inbox, id, title, { inboxStatus: 'inbox' })
          void applyDatabaseTemplate(space.inbox, id).catch(() => {})
        } catch (err) {
          setText(title)
          toast(`Could not capture: ${message(err)}`)
        }
      }}
    >
      <Inbox size={14} />
      <input aria-label="Capture to the Inbox" placeholder="Capture a thought… (Enter)" value={text} onChange={(e) => setText(e.target.value)} />
    </form>
  )
}

function SpacePanel({ space }: { space: Space }) {
  const o = useOverview(space)
  // Spaces made before PARA had templates get them once.
  useEffect(() => {
    if (!space.templates || !Object.keys(space.templates).length) void ensureParaTemplates(space).catch(() => {})
    else void linkParaTemplates(space).catch(() => {})
  }, [space])
  const [showArchive, setShowArchive] = useState(false)
  const overdue = o?.areas.filter((a) => a.overdue) ?? []
  const nav = (role: ParaRole, icon: string, name: string, count?: number, warn?: number, view?: string) => (
    <button className="para-nav" onClick={(e) => openRole(space, role, view, e.ctrlKey || e.metaKey ? 'tab' : 'replace')}>
      <span className="para-nav-icon">{icon}</span>
      <span className="para-nav-name">{name}</span>
      {!!warn && <span className="para-badge warn" title={`${warn} overdue`}>{warn}</span>}
      {count != null && <span className="count">{count}</span>}
    </button>
  )
  return (
    <>
      <Capture space={space} />
      <div className="para-navs">
        {nav('inbox', '📥', 'Inbox', o?.inbox)}
        {nav('projects', '🚀', 'Projects', o?.projects.length, o?.projects.filter((p) => p.overdue).length)}
        {nav('areas', '🧭', 'Areas', o?.areas.length, overdue.length)}
        {nav('resources', '📚', 'Resources')}
        <button className={`para-nav ${showArchive ? 'on' : ''}`} onClick={() => setShowArchive(!showArchive)}>
          <span className="para-nav-icon">🗄️</span>
          <span className="para-nav-name">Archive</span>
          <span className="count">{o?.archive.length ?? ''}</span>
        </button>
      </div>

      {showArchive && (
        <section className="para-sec">
          <h4>Archive</h4>
          {!o?.archive.length && <p className="para-empty">Nothing archived yet.</p>}
          {o?.archive.slice(0, 40).map((a) => (
            <div key={a.id} className="para-item muted">
              <button className="para-item-main" onClick={() => openPage(a.id, 'replace')}>
                <span>{a.icon || KIND_ICON[a.kind]}</span>
                <span className="para-item-title">{a.title || 'Untitled'}</span>
                <small>
                  {a.reason ? reasonName[a.reason] : a.kind}
                  {a.archivedAt ? ` · ${a.archivedAt}` : ''}
                </small>
              </button>
              <button className="row-btn" title="Restore" aria-label="Restore" onClick={() => paraUnarchive(a.id).catch((e) => toast(message(e)))}>
                <ArchiveRestore size={13} />
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="para-sec">
        <h4>
          To triage <span className="count">{o?.inbox ?? ''}</span>
        </h4>
        {o?.inbox === 0 && <p className="para-empty">Inbox zero. 🎉</p>}
        {o?.inboxNotes.slice(0, 15).map((n) => (
          <InboxRow key={n.id} id={n.id} pinned={n.pinned} space={space} />
        ))}
        {o && o.inbox > 15 && (
          <button className="tpl-side-link" onClick={() => openRole(space, 'inbox')}>
            {o.inbox - 15} more in the Inbox
          </button>
        )}
      </section>

      {overdue.length > 0 && (
        <section className="para-sec">
          <h4>Reviews due</h4>
          {overdue.map((a) => (
            <div key={a.id} className="para-item">
              <button className="para-item-main" onClick={() => openPage(a.id, 'replace')}>
                <span>{a.icon || '🧭'}</span>
                <span className="para-item-title">{a.title || 'Untitled'}</span>
                <small className="warn">{dueText(a.dueIn)}</small>
              </button>
              <button
                className="row-btn"
                title="Mark reviewed today"
                aria-label="Mark reviewed"
                onClick={() => paraReviewed(a.id).then(() => toast(`Reviewed ${a.title || 'the area'}`), (e) => toast(message(e)))}
              >
                <CalendarCheck size={13} />
              </button>
            </div>
          ))}
        </section>
      )}

      {o && o.areas.length > 0 && (
        <section className="para-sec">
          <h4>Areas</h4>
          {o.areas.map((a) => (
            <button key={a.id} className="para-item para-item-main" onClick={() => openPage(a.id, 'replace')}>
              <span className={`para-dot ${a.health ?? ''}`} title={a.health ? HEALTH[a.health] : 'No health set'} />
              <span className="para-item-title">{a.title || 'Untitled'}</span>
              <small>{a.activeProjects ? `${a.activeProjects} active` : ''}</small>
            </button>
          ))}
        </section>
      )}

      {o && o.projects.length > 0 && (
        <section className="para-sec">
          <h4>Next actions</h4>
          {o.projects.slice(0, 12).map((p) => (
            <button key={p.id} className="para-item para-item-main para-project" onClick={() => openPage(p.id, 'replace')}>
              <span>{p.icon || '🚀'}</span>
              <span className="para-item-title">
                {p.title || 'Untitled'}
                {p.nextAction && <em>{p.nextAction}</em>}
              </span>
              {p.deadline && <small className={p.overdue ? 'warn' : ''}>{p.deadline}</small>}
            </button>
          ))}
        </section>
      )}

      <button className="tpl-side-link" onClick={() => openPage(space.hub, 'replace')}>
        Open the PARA page
      </button>
      <button className="tpl-side-link" onClick={() => setView('templates')}>
        Edit the page templates
      </button>
    </>
  )
}

function InboxRow({ id, pinned, space }: { id: string; pinned: boolean; space: Space }) {
  const page = useApp((s) => s.pages[id])
  if (!page) return null
  return (
    <div className="para-item">
      <button className="para-item-main" onClick={() => openPage(id, 'replace')}>
        <span>{page.icon || (pinned ? '📌' : '📝')}</span>
        <span className="para-item-title">{page.title || 'Untitled'}</span>
      </button>
      <button className="row-btn" title="Promote to project" aria-label="Promote to project" onClick={() => openParaDialog({ kind: 'promote', rowId: id, space })}>
        <Rocket size={13} />
      </button>
      <button className="row-btn" title="Link & process" aria-label="Link & process" onClick={() => openParaDialog({ kind: 'process', rowId: id, space })}>
        <Check size={13} />
      </button>
      <button className="row-btn" title="Archive" aria-label="Archive" onClick={() => openParaDialog({ kind: 'archive', rowId: id, space, role: 'inbox' })}>
        <Archive size={13} />
      </button>
    </div>
  )
}

/** The PARA sidebar view: capture, the four lists, triage, reviews due, next actions. */
export function ParaView() {
  const spaces = useSpaces()
  return (
    <>
      <div className="sidebar-heading">
        <span>PARA</span>
      </div>
      <div className="para-side">{spaces == null ? <p className="para-empty">Loading…</p> : spaces.length === 0 ? <Setup /> : <SpacePanel space={spaces[0]} />}</div>
    </>
  )
}

/** On the space's own page: the same panel, laid out wide. */
export function ParaHub({ pageId }: { pageId: string }) {
  const space = useSpaces()?.find((s) => s.hub === pageId)
  if (!space) return null
  return (
    <div className="para-hub">
      <SpacePanel space={space} />
    </div>
  )
}
