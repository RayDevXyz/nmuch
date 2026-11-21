/**
 * The connection to the Rust core. Everything the app stores goes through `call`, and every
 * committed change comes back through `onEvent`.
 *
 * - In the desktop app: the Tauri command `core_call` and the `core-event` event.
 * - In a browser (`pnpm dev`): the dev server (`cargo run -p bw-devserver`) over HTTP and SSE,
 *   reached through Vite's `/api` proxy.
 */
export type CoreEvent =
  | { type: 'pageCreated'; pageId: string; seq: number }
  | { type: 'pageChanged'; pageId: string; seq: number; origin: 'local' | 'remote' }
  | { type: 'pageDeleted'; pageId: string }
  | { type: 'indexRebuilt'; pages: number }
  /** Files changed in a folder a module may read. */
  | { type: 'fsChanged'; moduleId: string; root: string }

export interface CoreClient {
  kind: 'tauri' | 'dev'
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>
  onEvent(cb: (e: CoreEvent) => void): () => void
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function tauriClient(): Promise<CoreClient> {
  const { invoke } = await import('@tauri-apps/api/core')
  const { listen } = await import('@tauri-apps/api/event')
  const subs = new Set<(e: CoreEvent) => void>()
  await listen<CoreEvent>('core-event', (e) => subs.forEach((cb) => cb(e.payload)))
  return {
    kind: 'tauri',
    call: (command, args) => invoke('core_call', { command, args: args ?? {} }),
    onEvent: (cb) => (subs.add(cb), () => subs.delete(cb)),
  }
}

let signingOut = false

/**
 * Commands that change something. After one succeeds the app tells its own views at once,
 * so a cell edited here shows up even when the live event stream is slow or held back by a
 * reverse proxy. (`pushUpdate`, the editor's typing, is left out: the editor already shows it.)
 */
const WRITES =
  /^(create|update|delete|remove|set|convert|install|import|rebuild|approve|grant|revoke|widgetMutate|widgetCreateRow|course(Import|Setup|Sync)|dnd(Add|Create|Import|Set)|burrowSave)/

function devClient(): CoreClient {
  const subs = new Set<(e: CoreEvent) => void>()
  const emit = (e: CoreEvent) => subs.forEach((cb) => cb(e))
  const source = new EventSource('/api/events')
  source.onmessage = (m) => emit(JSON.parse(m.data) as CoreEvent)
  // The stream dropped and came back (a proxy timeout, the laptop slept): events may have
  // been missed, so have every view re-read.
  let dropped = false
  source.onerror = () => (dropped = true)
  source.onopen = () => {
    if (dropped) emit({ type: 'indexRebuilt', pages: -1 })
    dropped = false
  }
  return {
    kind: 'dev',
    call: async (command, args) => {
      const res = await fetch(`/api/${command}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      })
      // Signed out (a hosted BrainWaves, the session ended): back to the sign-in.
      if (res.status === 401 && !signingOut) {
        signingOut = true
        location.reload()
      }
      if (!res.ok) throw new Error((await res.text()) || `${command} failed (${res.status})`)
      const out = await res.json()
      if (WRITES.test(command)) {
        const a = (args ?? {}) as Record<string, unknown>
        const pageId = String(a.rowId ?? a.pageId ?? a.databaseId ?? a.id ?? '')
        queueMicrotask(() => emit({ type: 'pageChanged', pageId, seq: -1, origin: 'local' }))
      }
      return out
    },
    onEvent: (cb) => (subs.add(cb), () => subs.delete(cb)),
  }
}

let client: Promise<CoreClient> | null = null

export function connectCore(): Promise<CoreClient> {
  client ??= isTauri ? tauriClient() : Promise.resolve(devClient())
  return client
}

// ---- base64 for yrs updates

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
