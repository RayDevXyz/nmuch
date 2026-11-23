import { Archive, ArchiveRestore, CalendarCheck, Check, Rocket } from 'lucide-react'
import { toast, useApp } from '../state/store'
import type { Property, Row } from '../database/types'
import { message, openParaDialog, paraReviewed, paraUnarchive, type ParaRole, type Space } from './api'

/** The triage buttons on a row of a PARA database, opened as a page. */
export function ParaRowActions({ rowId, space, role }: { rowId: string; space: Space; role: ParaRole }) {
  const archived = useApp((s) => s.pages[rowId]?.archived)
  if (archived)
    return (
      <button className="db-row-action" onClick={() => paraUnarchive(rowId).then(() => toast('Restored'), (e) => toast(message(e)))}>
        <ArchiveRestore size={13} /> Restore
      </button>
    )
  return (
    <>
      {role === 'inbox' && (
        <>
          <button className="db-row-action primary" onClick={() => openParaDialog({ kind: 'promote', rowId, space })}>
            <Rocket size={13} /> Promote to project
          </button>
          <button className="db-row-action" onClick={() => openParaDialog({ kind: 'process', rowId, space })}>
            <Check size={13} /> Link & process
          </button>
        </>
      )}
      {role === 'areas' && (
        <button className="db-row-action" onClick={() => paraReviewed(rowId).then(() => toast('Reviewed today'), (e) => toast(message(e)))}>
          <CalendarCheck size={13} /> Mark reviewed
        </button>
      )}
      <button className="db-row-action" onClick={() => openParaDialog({ kind: 'archive', rowId, space, role })}>
        <Archive size={13} /> Archive
      </button>
    </>
  )
}

const ARCHIVE_COLS = ['archived', 'archivedAt', 'archiveReason']

/**
 * Progressive disclosure: which properties a PARA row shows before "more". Inbox notes show
 * none (the drawer starts closed); the others show the fields their type requires. Anything
 * with a value shows too, and the archive columns only on archived rows.
 */
export function paraShown(role: ParaRole, space: Space, p: Property, row: Row): boolean {
  const c = space.columns
  const required: Record<ParaRole, string[]> = {
    inbox: [],
    projects: ['status', 'deadline', c.projectArea, 'outcome', 'nextAction'],
    areas: ['standard', 'health', 'cadence', 'lastReviewed', c.areaProjects],
    resources: ['domain', 'resourceType', c.resourceAreas, c.resourceProjects],
  }
  if (ARCHIVE_COLS.includes(p.id)) return row.values.archived === true && p.id !== 'archived'
  if (required[role].includes(p.id)) return true
  if (role === 'inbox') return false
  const v = row.values[p.id]
  return v != null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)
}
