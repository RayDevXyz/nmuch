import { useEffect, useState, useSyncExternalStore } from 'react'
import { isTauri } from '../lib/core/client'
import { coreClient } from '../lib/storage'

/** Mirrors of `crates/bw-core/src/modules.rs` and `course.rs`. */

export interface ModuleManifest {
  id: string
  name: string
  description?: string
  version?: string
  icon?: string
  namespace: string
  capabilities: string[]
}

export interface ModuleInfo {
  manifest: ModuleManifest
  builtin: boolean
  installedAt: number
  approved: boolean
  /** Capabilities waiting for approval, described for people. */
  pending: string[]
  folders: string[]
  code?: string
}

export interface Tracker {
  courses: string
  lessons: string
  coursesView: string
  lessonsView: string
  link: string
  backlink: string
}

export interface SyncReport {
  course: string
  added: number
  missing: number
  restored: number
}

export const COURSE_MODULE = 'brainwaves.course'

const call = <T>(command: string, args: Record<string, unknown> = {}) => coreClient().call<T>(command, args)

export const listModules = () => call<ModuleInfo[]>('listModules')
export const moduleInfo = (id: string) => call<ModuleInfo>('moduleInfo', { id })
export const installModule = (manifest: ModuleManifest, code: string) => call<ModuleInfo>('installModule', { manifest, code })
export const removeModule = (id: string) => call<void>('removeModule', { id })
export const approveModule = (id: string) => call<void>('approveModule', { id })
export const revokeModule = (id: string) => call<void>('revokeModule', { id })
export const grantFolder = (moduleId: string, path: string) => call<string>('grantFolder', { moduleId, path })
export const revokeFolder = (moduleId: string, path: string) => call<void>('revokeFolder', { moduleId, path })

export const courseSetup = (parentId: string | null) => call<Tracker>('courseSetup', { parentId })
export const courseTrackers = () => call<Tracker[]>('courseTrackers')
export const courseImport = (coursesDb: string, folder: string) => call<SyncReport>('courseImport', { coursesDb, folder })
export const courseSync = (id: string) => call<SyncReport>('courseSync', { id })
export const courseOpenLesson = (id: string) => call<{ path: string; opened: boolean }>('courseOpenLesson', { id })

/** A sandboxed module's call; `moduleId` comes from the host, never from the module. */
export const moduleCall = (moduleId: string, op: string, args: Record<string, unknown>) => call<unknown>('moduleCall', { moduleId, op, args })

/** What each capability means, for the approval dialog (same wording as the core). */
export function describeCapability(c: string): string {
  if (c.startsWith('fs.read:')) return `Read files in ${c.slice(8)}`
  return (
    {
      'db.own': 'Create its own databases and change them',
      'db.read': 'Read all your databases',
      'db.write': 'Change rows in any of your databases',
      'fs.pick': 'Ask you to choose folders it may read',
      'fs.open': 'Open files it can read in their default app',
    }[c] ?? c
  )
}

/**
 * Ask the user for a folder. The desktop app shows the system's folder dialog; in a browser
 * (the dev server runs on this machine) a path is typed instead.
 */
export async function pickFolder(title: string): Promise<string | null> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string | null>('pick_folder', { title })
  }
  const p = window.prompt(`${title}\n\nPath of the folder:`)
  return p?.trim() || null
}

/** Pick a folder and give it to a module. Returns its real path, or null if cancelled. */
export async function chooseFolderFor(moduleId: string, title: string): Promise<string | null> {
  const path = await pickFolder(title)
  return path ? grantFolder(moduleId, path) : null
}

// ---- installed modules, shared by the slash menu and the modules manager

let modules: ModuleInfo[] = []
const listeners = new Set<() => void>()

export async function refreshModules() {
  modules = await listModules()
  listeners.forEach((l) => l())
}

export const installedModules = () => modules

export function useModules(): ModuleInfo[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => modules,
  )
}

// ---- which databases belong to a course tracker (cached; trackers rarely change)

let trackers: Promise<Tracker[]> | null = null
export function refreshTrackers() {
  trackers = courseTrackers().catch(() => [])
  return trackers
}

/** The tracker a database belongs to, and which side it is. */
export function useCourseRole(databaseId: string): { tracker: Tracker; role: 'courses' | 'lessons' } | null {
  const [found, setFound] = useState<{ tracker: Tracker; role: 'courses' | 'lessons' } | null>(null)
  useEffect(() => {
    let live = true
    void (trackers ?? refreshTrackers()).then((ts) => {
      const t = ts.find((x) => x.courses === databaseId || x.lessons === databaseId)
      if (live) setFound(t ? { tracker: t, role: t.courses === databaseId ? 'courses' : 'lessons' } : null)
    })
    return () => {
      live = false
    }
  }, [databaseId])
  return found
}
