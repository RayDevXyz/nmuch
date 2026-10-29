import { coreClient } from '../lib/storage'
import type { DatabaseResult, Property, View } from './types'

/** Thin wrappers over the database commands of the core (`crates/bw-api`). */
const call = <T>(command: string, args: Record<string, unknown>) => coreClient().call<T>(command, args)

export const queryDatabase = (databaseId: string, viewId?: string, view?: View) =>
  call<DatabaseResult>('queryDatabase', { databaseId, viewId, view })

export const setProperty = (databaseId: string, property: Partial<Property> & Pick<Property, 'id' | 'name' | 'type'>) =>
  call<void>('setProperty', { databaseId, property: { order: '', ...property } })

export const createRelation = (databaseId: string, relation: { name: string; targetDatabase: string; twoWay: boolean; reverseName?: string }) =>
  call<{ propertyId: string; reversePropertyId: string | null }>('createRelation', { databaseId, relation })

export const removeProperty = (databaseId: string, propertyId: string) => call<void>('removeProperty', { databaseId, propertyId })

export const setView = (databaseId: string, view: View) => call<void>('setView', { databaseId, view })

export const removeView = (databaseId: string, viewId: string) => call<void>('removeView', { databaseId, viewId })

export const createRow = (databaseId: string, id: string, title = '', values: Record<string, unknown> = {}) =>
  call<string>('createRow', { databaseId, id, title, values })

export const setValue = (rowId: string, propertyId: string, value: unknown) => call<void>('setValue', { rowId, propertyId, value })

export const databaseDef = (databaseId: string) =>
  call<{ properties: import('./types').Property[]; views: View[] }>('databaseDef', { databaseId })
