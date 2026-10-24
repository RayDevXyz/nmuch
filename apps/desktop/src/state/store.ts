import { useSyncExternalStore } from 'react'
import type { Page } from '../lib/types'

export type View = 'home' | 'recent' | 'favorites' | 'tags' | 'archive' | 'trash'

export interface OutlineItem {
  id: string
  type: 'h1' | 'h2' | 'h3'
  text: string
}

export interface AppState {
  ready: boolean
  storageKind: 'sqlite' | 'browser'
  pages: Record<string, Page>
  view: View
  tag: string | null
  tabs: string[]
  activeId: string | null
  theme: 'dark' | 'light'
  sidebarOpen: boolean
  rightOpen: boolean
  expanded: Record<string, boolean>
  width: 'normal' | 'wide'
  fontSize: 'small' | 'normal' | 'large'
  spellcheck: boolean
  save: 'saved' | 'saving' | 'error'
  saveError: string | null
  stats: { words: number; blocks: number }
  outline: OutlineItem[]
  currentHeading: string | null
  indexVersion: number
  quickFind: boolean
  help: boolean
  /** request for the editor to scroll to / focus a block once a page is open */
  reveal: { pageId: string; blockId: string } | null
  toast: string | null
}

const PREFS_KEY = 'nimbus.prefs.v1'
type Prefs = Pick<AppState, 'view' | 'tabs' | 'activeId' | 'theme' | 'sidebarOpen' | 'rightOpen' | 'expanded' | 'width' | 'fontSize' | 'spellcheck'>

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}

let state: AppState = {
  ready: false,
  storageKind: 'browser',
  pages: {},
  view: 'home',
  tag: null,
  tabs: [],
  activeId: null,
  theme: 'dark',
  sidebarOpen: true,
  rightOpen: true,
  expanded: {},
  width: 'normal',
  fontSize: 'normal',
  spellcheck: true,
  save: 'saved',
  saveError: null,
  stats: { words: 0, blocks: 0 },
  outline: [],
  currentHeading: null,
  indexVersion: 0,
  quickFind: false,
  help: false,
  reveal: null,
  toast: null,
  ...loadPrefs(),
}

const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

let prefsTimer: ReturnType<typeof setTimeout> | undefined

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach((l) => l())
  clearTimeout(prefsTimer)
  prefsTimer = setTimeout(() => {
    const { view, tabs, activeId, theme, sidebarOpen, rightOpen, expanded, width, fontSize, spellcheck } = state
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view, tabs, activeId, theme, sidebarOpen, rightOpen, expanded, width, fontSize, spellcheck }))
    } catch {
      /* storage unavailable */
    }
  }, 250)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Selector must return a stable reference (a state field or a primitive). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string) {
  setState({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setState({ toast: null }), 2200)
}
