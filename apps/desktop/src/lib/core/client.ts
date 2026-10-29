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

function devClient(): CoreClient {
  const subs = new Set<(e: CoreEvent) => void>()
  const source = new EventSource('/api/events')
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as CoreEvent
    subs.forEach((cb) => cb(e))
  }
  return {
    kind: 'dev',
    call: async (command, args) => {
      const res = await fetch(`/api/${command}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      })
      if (!res.ok) throw new Error((await res.text()) || `${command} failed (${res.status})`)
      return res.json()
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
