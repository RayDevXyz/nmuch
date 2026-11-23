import { useEffect, useState, useSyncExternalStore } from 'react'
import { coreClient } from '../lib/storage'

/** Mirrors of `crates/bw-core/src/para.rs`. */

export type ParaRole = 'inbox' | 'projects' | 'areas' | 'resources'

export interface Space {
  hub: string
  inbox: string
  projects: string
  areas: string
  resources: string
  /** Saved views by name, per role. */
  views: Record<ParaRole, Record<string, string>>
  /** Relation columns (`noteProjects`, `projectArea`, …). */
  columns: Record<string, string>
}

export interface AreaHealth {
  id: string
  title: string
  icon: string
  health?: string | null
  cadence?: string | null
  lastReviewed?: string | null
  activeProjects: number
  dueIn?: number | null
  overdue: boolean
}

export interface ProjectDue {
  id: string
  title: string
  icon: string
  status?: string | null
  deadline?: string | null
  nextAction?: string | null
  area?: string | null
  overdue: boolean
}

export interface Archived {
  id: string
  title: string
  icon: string
  kind: 'note' | 'project' | 'area' | 'resource'
  databaseId: string
  archivedAt?: string | null
  reason?: string | null
}

export interface Overview {
  space: Space
  today: string
  inbox: number
  inboxNotes: { id: string; title: string; icon: string; pinned: boolean; noteType?: string | null }[]
  someday: number
  areas: AreaHealth[]
  projects: ProjectDue[]
  archive: Archived[]
}

export interface Promote {
  status?: string
  deadline?: string
  area?: string
  outcome?: string
  nextAction?: string
  priority?: string
}

export interface Links {
  projects?: string[]
  areas?: string[]
  resources?: string[]
}

export const PARA_MODULE = 'brainwaves.para'

export const STATUSES: [string, string][] = [
  ['not_started', 'Not started'],
  ['in_progress', 'In progress'],
  ['on_hold', 'On hold'],
  ['completed', 'Completed'],
  ['canceled', 'Canceled'],
]
export const REASONS: [string, string][] = [
  ['completed', 'Completed'],
  ['canceled', 'Canceled'],
  ['on_ice', 'On ice'],
  ['deprecated', 'Deprecated'],
]
export const HEALTH: Record<string, string> = { critical: 'Critical', needs_attention: 'Needs attention', on_track: 'On track' }

const call = <T>(command: string, args: Record<string, unknown> = {}) => coreClient().call<T>(command, args)

export const paraSetup = (parentId: string | null) => call<Space>('paraSetup', { parentId }).finally(refreshSpaces)
export const paraSpaces = () => call<Space[]>('paraSpaces')
export const paraOverview = (id: string) => call<Overview>('paraOverview', { id })
export const paraPromote = (id: string, promote: Promote) => call<string>('paraPromote', { id, promote })
export const paraProcess = (id: string, links: Links) => call<void>('paraProcess', { id, links })
export const paraArchive = (id: string, reason: string | null) => call<void>('paraArchive', { id, reason })
export const paraUnarchive = (id: string) => call<void>('paraUnarchive', { id })
export const paraReviewed = (id: string) => call<void>('paraReviewed', { id })

// ---- the spaces of this workspace, shared by every component that asks

let spaces: Space[] | null = null
let loading: Promise<Space[]> | null = null
const subs = new Set<() => void>()

export function refreshSpaces(): Promise<Space[]> {
  loading = paraSpaces()
    .catch(() => [] as Space[])
    .then((s) => {
      spaces = s
      subs.forEach((f) => f())
      return s
    })
  return loading
}

export function useSpaces(): Space[] | null {
  const s = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => spaces,
  )
  useEffect(() => {
    if (!spaces && !loading) void refreshSpaces()
  }, [])
  return s
}

/** The space a database belongs to, and its role there. */
export function useParaRole(databaseId: string | null | undefined): { space: Space; role: ParaRole } | null {
  const all = useSpaces()
  if (!all || !databaseId) return null
  for (const space of all) {
    const role = (['inbox', 'projects', 'areas', 'resources'] as ParaRole[]).find((r) => space[r] === databaseId)
    if (role) return { space, role }
  }
  return null
}

/** The overview of a space, re-read whenever something changes. */
export function useOverview(space: Space | null | undefined): Overview | null {
  const [o, setO] = useState<Overview | null>(null)
  const hub = space?.hub
  useEffect(() => {
    if (!hub) return setO(null)
    let live = true
    let t: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      paraOverview(hub).then(
        (r) => live && setO(r),
        () => live && setO(null),
      )
    void load()
    const off = coreClient().onEvent(() => {
      clearTimeout(t)
      t = setTimeout(load, 120)
    })
    return () => {
      live = false
      off()
      clearTimeout(t)
    }
  }, [hub])
  return o
}

// ---- open a database on one of its views

let asked: { databaseId: string; viewId: string; n: number } | null = null
const viewSubs = new Set<() => void>()

/** Ask the database page to show this view (see `useAskedView`). */
export function askView(databaseId: string, viewId: string | undefined) {
  if (!viewId) return
  asked = { databaseId, viewId, n: (asked?.n ?? 0) + 1 }
  viewSubs.forEach((f) => f())
}

export function clearAsk() {
  asked = null
  viewSubs.forEach((f) => f())
}

export function useAskedView(databaseId: string) {
  const a = useSyncExternalStore(
    (f) => (viewSubs.add(f), () => viewSubs.delete(f)),
    () => asked,
  )
  return a && a.databaseId === databaseId ? a : null
}

// ---- the triage dialogs (rendered once, by ParaDialogs)

export type Dialog =
  | { kind: 'promote'; rowId: string; space: Space }
  | { kind: 'process'; rowId: string; space: Space }
  | { kind: 'archive'; rowId: string; space: Space; role: ParaRole }
  | null

let dialog: Dialog = null
const dialogSubs = new Set<() => void>()
export function openParaDialog(d: Dialog) {
  dialog = d
  dialogSubs.forEach((f) => f())
}
export function useParaDialog(): Dialog {
  return useSyncExternalStore(
    (f) => (dialogSubs.add(f), () => dialogSubs.delete(f)),
    () => dialog,
  )
}

export const message = (e: unknown) => String(e).replace(/^Error:\s*/, '')

/** "in 3 days", "2 days overdue", "due today". */
export function dueText(days: number | null | undefined): string {
  if (days == null) return 'never reviewed'
  if (days === 0) return 'due today'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  return `${-days} day${days === -1 ? '' : 's'} overdue`
}
