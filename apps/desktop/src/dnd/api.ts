import { useSyncExternalStore } from 'react'
import { coreClient } from '../lib/storage'
import { getState } from '../state/store'
import type { Sheet } from './rules'

/** Mirrors of `crates/bw-core/src/dnd.rs`. */

export interface CampaignParts {
  npcs: string
  locations: string
  factions: string
  sessions: string
  beats: string
  map: string
  beatSession: string
  beatNpcs: string
  beatLocations: string
  beatFactions: string
}

export interface Campaign {
  id: string
  title: string
  parts: CampaignParts | null
}

export interface Workspace {
  campaigns: string
  characters: string
  characterCampaign: string
  campaignParty: string
}

const call = <T>(command: string, args: Record<string, unknown> = {}) => coreClient().call<T>(command, args)

export const dndWorkspace = () => call<Workspace>('dndWorkspace')
export const dndCampaigns = () => call<Campaign[]>('dndCampaigns')
export const dndCampaign = (id: string) => call<Campaign>('dndCampaign', { id })
export const createCampaign = (title: string) => call<Campaign>('dndCreateCampaign', { title })
export const addBeats = (id: string, template: string, arc = '') => call<string[]>('dndAddBeats', { id, template, arc })
export const createCharacter = (name: string, sheet: Sheet, campaign?: string | null) => call<string>('dndCreateCharacter', { name, sheet, campaign: campaign ?? null })
export const getSheet = (id: string) => call<Sheet>('dndSheet', { id })
export const saveSheet = (id: string, sheet: Sheet) => call<void>('dndSetSheet', { id, sheet })

export const TEMPLATES: { id: string; label: string; desc: string }[] = [
  { id: 'three-act', label: 'Three acts', desc: 'Hook, rising trouble, midpoint twist, darkest hour, climax' },
  { id: 'heros-journey', label: "Hero's journey", desc: 'Call to adventure, mentor, ordeal, reward, return' },
  { id: 'five-room', label: 'Five-room dungeon', desc: 'Guardian, puzzle, setback, climax, revelation' },
  { id: 'mystery', label: 'Mystery', desc: 'Crime, clues, suspects, red herring, confrontation' },
  { id: 'heist', label: 'Heist', desc: 'The job, casing, plan, complication, double-cross, getaway' },
]

// ---- which pages are D&D pages (kept fresh as the workspace changes)

let roles: Record<string, string> = {}
const listeners = new Set<() => void>()
let started = false

async function refresh() {
  try {
    const next = await call<Record<string, string>>('dndRoles')
    if (JSON.stringify(next) !== JSON.stringify(roles)) {
      roles = next
      listeners.forEach((l) => l())
    }
  } catch {
    /* core not ready yet: the next event retries */
  }
}

function start() {
  if (started) return
  started = true
  void refresh()
  let t: ReturnType<typeof setTimeout> | undefined
  coreClient().onEvent((e) => {
    if (e.type === 'pageChanged' && e.origin === 'remote') return
    clearTimeout(t)
    t = setTimeout(() => void refresh(), 300)
  })
}

export function useRoles(): Record<string, string> {
  start()
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => roles,
  )
}

export const refreshRoles = refresh

/** The roles as last loaded (outside React). */
export const getRoles = () => roles

/** Whether a page shows as a canvas: the user's choice, else canvas for world maps. */
export const showsCanvas = (pageId: string, choice: Record<string, boolean>, r: Record<string, string>) => choice[pageId] ?? r[pageId] === 'map'

/** The Characters database's id, if the workspace has one. */
export const charactersDb = (r: Record<string, string>) => Object.keys(r).find((id) => r[id] === 'characters') ?? null

/**
 * Pages that get the campaign look: D&D databases, campaigns, characters, and everything under
 * a campaign (its NPC pages, session notes, the world map, …).
 */
export function isThemed(pageId: string, r: Record<string, string>): boolean {
  const pages = getState().pages
  const chars = charactersDb(r)
  let id: string | null = pageId
  for (let depth = 0; id && depth < 32; depth++) {
    if (r[id]) return true
    const p: (typeof pages)[string] | undefined = pages[id]
    if (!p) return false
    if (chars && p.databaseId === chars) return true
    id = p.parentId ?? p.databaseId ?? null
  }
  return false
}
