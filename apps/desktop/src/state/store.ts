import { useSyncExternalStore } from 'react'
import type { Page } from '../lib/types'
import type { ThemeDef } from '../theme/themes'

export type View = 'home' | 'recent' | 'favorites' | 'tags' | 'archive' | 'trash' | 'burrow'

export interface OutlineItem {
  id: string
  type: 'h1' | 'h2' | 'h3'
  text: string
}

export interface AppState {
  ready: boolean
  storageKind: 'sqlite' | 'dev'
  pages: Record<string, Page>
  view: View
  tag: string | null
  tabs: string[]
  activeId: string | null
  theme: 'dark' | 'light'
  /** The user's own themes (see `theme/themes.ts`). */
  themes: ThemeDef[]
  /** Which theme each mode uses (built-in or the user's); unset: the mode's own look. */
  themeFor: Partial<Record<'dark' | 'light', string>>
  themeEditor: boolean
  sidebarOpen: boolean
  rightOpen: boolean
  expanded: Record<string, boolean>
  width: 'normal' | 'wide'
  fontSize: 'small' | 'normal' | 'large'
  spellcheck: boolean
  /** Pages shown as an edgeless canvas instead of a document. */
  edgeless: Record<string, boolean>
  save: 'saved' | 'saving' | 'error'
  saveError: string | null
  stats: { words: number; blocks: number }
  outline: OutlineItem[]
  currentHeading: string | null
  indexVersion: number
  quickFind: boolean
  help: boolean
  /** The "Import from Nimbus" dialog is open. */
  importDialog: boolean
  widgetsDialog: boolean
  modulesDialog: boolean
  /** request for the editor to scroll to / focus a block once a page is open */
  reveal: { pageId: string; blockId: string } | null
  toast: string | null
}

const PREFS_KEY = 'brainwaves.prefs.v1'
/** Preferences saved before the rename to BrainWaves. */
const OLD_PREFS_KEY = 'nimbus.prefs.v1'
type Prefs = Pick<AppState, 'view' | 'tabs' | 'activeId' | 'theme' | 'themes' | 'themeFor' | 'sidebarOpen' | 'rightOpen' | 'expanded' | 'width' | 'fontSize' | 'spellcheck' | 'edgeless'>

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || localStorage.getItem(OLD_PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}

let state: AppState = {
  ready: false,
  storageKind: 'sqlite',
  pages: {},
  view: 'home',
  tag: null,
  tabs: [],
  activeId: null,
  theme: 'dark',
  themes: [],
  themeFor: {},
  themeEditor: false,
  sidebarOpen: true,
  rightOpen: true,
  expanded: {},
  width: 'normal',
  fontSize: 'normal',
  spellcheck: true,
  edgeless: {},
  save: 'saved',
  saveError: null,
  stats: { words: 0, blocks: 0 },
  outline: [],
  currentHeading: null,
  indexVersion: 0,
  quickFind: false,
  help: false,
  importDialog: false,
  widgetsDialog: false,
  modulesDialog: false,
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
    const { view, tabs, activeId, theme, themes, themeFor, sidebarOpen, rightOpen, expanded, width, fontSize, spellcheck, edgeless } = state
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view, tabs, activeId, theme, themes, themeFor, sidebarOpen, rightOpen, expanded, width, fontSize, spellcheck, edgeless }))
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
