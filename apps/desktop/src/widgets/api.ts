import { useSyncExternalStore } from 'react'
import { flushAll } from '../lib/core/page-sync'
import { coreClient } from '../lib/storage'
import type { Filter, PropType, Sort } from '../database/types'

/** Mirrors of `crates/bw-core/src/widgets.rs`. */

export interface FieldSpec {
  label?: string
  types: PropType[]
  optional?: boolean
}

export interface SlotSpec {
  access: 'read' | 'write'
  label?: string
  description?: string
  fields: Record<string, FieldSpec>
}

export interface Manifest {
  id: string
  name: string
  description?: string
  version?: string
  icon?: string
  slots: Record<string, SlotSpec>
  height?: number
}

export interface WidgetDef {
  manifest: Manifest
  html?: string
  builtin: boolean
  installedAt: number
}

export interface Binding {
  databaseId: string
  fields: Record<string, string>
}

export interface WidgetQuery {
  filters?: Filter[]
  sorts?: Sort[]
  limit?: number
}

const call = <T>(command: string, args: Record<string, unknown> = {}) => coreClient().call<T>(command, args)

export const listWidgets = () => call<WidgetDef[]>('listWidgets')
export const widgetDef = (id: string) => call<WidgetDef>('widgetDef', { id })
export const installWidget = (manifest: Manifest, html: string, builtin = false) => call<void>('installWidget', { manifest, html, builtin })
export const removeWidget = (id: string) => call<void>('removeWidget', { id })

/** The calls a widget instance can make. `pageId` and `blockId` come from the host, never the widget. */
export interface Instance {
  pageId: string
  blockId: string
}
// The core reads bindings from the stored page, so edits still waiting to sync (a block just
// inserted, bindings just set) are pushed first.
const instanceCall = async <T>(command: string, args: Record<string, unknown>) => {
  await flushAll()
  return call<T>(command, args)
}
export const widgetQuery = (i: Instance, slot: string, query: WidgetQuery) => instanceCall<unknown>('widgetQuery', { ...i, slot, query })
export const widgetMutate = (i: Instance, slot: string, rowId: string, values: Record<string, unknown>) =>
  instanceCall<void>('widgetMutate', { ...i, slot, rowId, values })
export const widgetCreateRow = (i: Instance, slot: string, values: Record<string, unknown>) =>
  instanceCall<string>('widgetCreateRow', { ...i, slot, values })

// ---- installed widgets, shared by the slash menu and the widgets manager

let installed: WidgetDef[] = []
const listeners = new Set<() => void>()

export async function refreshWidgets() {
  installed = await listWidgets()
  listeners.forEach((l) => l())
}

export function installedWidgets(): WidgetDef[] {
  return installed
}

export function useInstalledWidgets(): WidgetDef[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => installed,
  )
}

/** Code is fetched once per widget and cached. */
const code = new Map<string, Promise<WidgetDef>>()
export function loadWidget(id: string, fresh = false): Promise<WidgetDef> {
  if (fresh || !code.has(id)) code.set(id, widgetDef(id))
  const p = code.get(id)!
  p.catch(() => code.delete(id))
  return p
}
