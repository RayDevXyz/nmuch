import { useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { coreClient } from '../lib/storage'
import { COLORS, readElements, type Element } from '../edgeless/model'

/**
 * A scene, live at the table (`crates/bw-table`). The DM's BrainWaves computes what players may
 * see and sends it whenever the scene changes:
 *
 * - the map picture (once per picture), the grid, the areas cleared of fog;
 * - tokens that aren't hidden: player characters always, others (with fog on) only when they
 *   stand in a cleared area;
 * - hit points for player characters only; monsters show "bloodied" or "down";
 * - the initiative order, without hidden creatures.
 *
 * Hidden tokens, fogged areas and everything else on the page stay here. From the table come
 * pings, temporary drawings, move requests (the DM accepts or declines them here), the player
 * list and dice rolls.
 */

export interface SceneSettings {
  grid: { size: number; offsetX: number; offsetY: number; show: boolean; color: string; opacity: number; feet: number }
  fog: boolean
  room: string | null
  initiative?: Initiative
}

export interface Initiative {
  round: number
  turn: number
  entries: { id: string; name: string; init: number | null; token?: string }[]
}

export interface Table {
  server: string
  key: string
}

export const getScene = (id: string) => coreClient().call<SceneSettings>('dndScene', { id })
export const setScene = (id: string, patch: Partial<SceneSettings>) => coreClient().call<SceneSettings>('dndSetScene', { id, sheet: patch })
export const getTable = () => coreClient().call<Table | null>('dndTable')
export const setTable = (url: string, key: string) => coreClient().call<void>('dndSetTable', { url, key })
export const createScene = (campaign: string, title: string) => coreClient().call<string>('dndCreateScene', { id: campaign, title })
export const listScenes = (campaign: string) => coreClient().call<string[]>('dndScenes', { id: campaign })

export interface Ping {
  id: string
  x: number
  y: number
  color: string
  name: string
  at: number
}
export interface Drawing {
  id: string
  points: [number, number][]
  color: string
  name: string
  until: number
}
export interface MoveRequest {
  id: string
  token: string
  x: number
  y: number
  name: string
  color: string
}
export interface Roll {
  name: string
  color: string
  expr: string
  detail: string
  total: number
  label?: string
  private?: boolean
  at: number
}
export interface Player {
  id: number
  name: string
  claim: string | null
  color: string
}

export interface LiveState {
  status: 'off' | 'connecting' | 'live' | 'error'
  error?: string
  room?: string
  joinUrl?: string
  players: Player[]
  pings: Ping[]
  drawings: Drawing[]
  requests: MoveRequest[]
  rolls: Roll[]
}

const idle = (): LiveState => ({ status: 'off', players: [], pings: [], drawings: [], requests: [], rolls: [] })

// ---- what players may see

const inside = (x: number, y: number, el: Element & { type: 'reveal' }): boolean => {
  const pts = el.points
  if (pts && pts.length > 2) {
    let inPoly = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inPoly = !inPoly
    }
    return inPoly
  }
  const [rx, ry, rw, rh] = el.xywh
  return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh
}

/** The player-safe view of a scene. Exported for tests: what must never leave is decided here. */
export function project(elements: Element[], settings: SceneSettings, title: string, imageHash: string | null) {
  const reveals = elements.filter((e): e is Element & { type: 'reveal' } => e.type === 'reveal')
  const image = elements.filter((e) => e.type === 'image').sort((a, b) => area(b) - area(a))[0] as (Element & { type: 'image' }) | undefined
  const visible = (e: Element & { type: 'token' }) => {
    if (e.hidden) return false
    // The party always sees itself; other creatures only where the fog is cleared.
    if (!settings.fog || e.player) return true
    const [x, y, w, h] = e.xywh
    return reveals.some((r) => inside(x + w / 2, y + h / 2, r))
  }
  const tokens = elements
    .filter((e): e is Element & { type: 'token' } => e.type === 'token')
    .filter(visible)
    .map((t) => {
      const [x, y, w, h] = t.xywh
      const base = { id: t.id, name: t.text || 'Creature', x, y, w, h, color: (t.color && COLORS[t.color]) || t.color || (t.player ? '#4f8fd8' : '#a34a3a'), player: !!t.player }
      if (t.player) return { ...base, hp: t.hp ?? null, maxHp: t.maxHp ?? null }
      const status = t.maxHp && t.hp != null ? (t.hp <= 0 ? 'down' : t.hp <= t.maxHp / 2 ? 'bloodied' : '') : ''
      return { ...base, status }
    })
  const shown = new Set(tokens.map((t) => t.id))
  const ini = settings.initiative
  return {
    title,
    image: image && imageHash ? { hash: imageHash, x: image.xywh[0], y: image.xywh[1], w: image.xywh[2], h: image.xywh[3] } : null,
    width: image?.xywh[2],
    height: image?.xywh[3],
    grid: settings.grid,
    fog: settings.fog,
    reveals: settings.fog ? reveals.map((r) => ({ x: r.xywh[0], y: r.xywh[1], w: r.xywh[2], h: r.xywh[3], points: r.points ?? null })) : [],
    tokens,
    initiative: ini && ini.entries.length ? { round: ini.round, turn: visibleTurn(ini, shown), entries: ini.entries.filter((e) => !e.token || shown.has(e.token)).map((e) => ({ name: e.name, init: e.init })) } : null,
  }
}

const area = (e: Element) => ('xywh' in e ? e.xywh[2] * e.xywh[3] : 0)

/** Whose turn it is, counted among the entries players can see. */
function visibleTurn(ini: Initiative, shown: Set<string>): number {
  let n = -1
  for (let i = 0; i <= ini.turn && i < ini.entries.length; i++) {
    const e = ini.entries[i]
    if (!e.token || shown.has(e.token)) n++
  }
  return Math.max(0, n)
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
}

// ---- the connection (one per scene page that is live)

export class Live {
  state: LiveState = idle()
  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  private stop: (() => void) | null = null
  private sent = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private closing = false

  constructor(
    readonly sceneId: string,
    private doc: Y.Doc,
    private getSettings: () => SceneSettings,
    private getTitle: () => string,
  ) {}

  subscribe = (l: () => void) => (this.listeners.add(l), () => this.listeners.delete(l))
  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** Make (or re-open) the scene's room and connect as the DM. */
  async start(table: Table, roomName: string): Promise<string> {
    this.closing = false
    this.set({ status: 'connecting', error: undefined })
    const server = table.server.replace(/\/+$/, '')
    const settings = this.getSettings()
    let code: string
    try {
      const res = await fetch(`${server}/api/rooms`, {
        method: 'POST',
        headers: { authorization: `Bearer ${table.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: roomName, code: settings.room ?? undefined }),
      })
      if (res.status === 401) throw new Error('The table server refused the DM key.')
      if (!res.ok) throw new Error(`The table server answered ${res.status}.`)
      code = (await res.json()).code
    } catch (e) {
      const msg = e instanceof TypeError ? `Can't reach the table server at ${server}.` : String(e).replace(/^Error:\s*/, '')
      this.set({ status: 'error', error: msg })
      throw new Error(msg)
    }
    if (settings.room !== code) await setScene(this.sceneId, { room: code })
    this.set({ room: code, joinUrl: `${server}/join/${code}` })
    this.connect(server, table.key, code)
    return code
  }

  private connect(server: string, key: string, code: string) {
    const url = `${server.replace(/^http/, 'ws')}/ws/${code}?key=${encodeURIComponent(key)}`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.set({ status: 'live', error: undefined })
      this.sent.clear()
      this.watch()
      void this.push()
    }
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data))
    ws.onclose = () => {
      this.stop?.()
      this.stop = null
      if (this.closing) return this.set({ ...idle(), room: this.state.room, joinUrl: this.state.joinUrl })
      this.set({ status: 'connecting', error: 'Connection lost, reconnecting…' })
      setTimeout(() => !this.closing && this.connect(server, key, code), 2500)
    }
  }

  end() {
    this.closing = true
    this.stop?.()
    this.stop = null
    this.ws?.close()
    this.ws = null
    this.set({ ...idle(), room: this.state.room, joinUrl: this.state.joinUrl })
  }

  /** Push again when the canvas changes (debounced). */
  private watch() {
    const surface = this.doc.getMap('surface')
    const changed = () => this.schedule()
    surface.observeDeep(changed)
    this.stop = () => surface.unobserveDeep(changed)
  }
  schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.push(), 120)
  }

  private send(m: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  private async push() {
    if (this.state.status !== 'live') return
    const elements = readElements(this.doc)
    const image = elements.filter((e) => e.type === 'image').sort((a, b) => area(b) - area(a))[0] as (Element & { type: 'image' }) | undefined
    let hash: string | null = null
    if (image) {
      hash = await sha256(image.src)
      if (!this.sent.has(hash)) {
        this.send({ t: 'image', hash, data: image.src })
        this.sent.add(hash)
      }
    }
    this.send({ t: 'scene', scene: project(elements, this.getSettings(), this.getTitle(), hash) })
  }

  private onMessage(m: Record<string, unknown> & { t: string }) {
    const now = Date.now()
    switch (m.t) {
      case 'welcome':
        this.set({ requests: (m.requests as MoveRequest[]) ?? [], rolls: ((m.rolls as Roll[]) ?? []).slice(-30).reverse() })
        break
      case 'players':
        this.set({ players: m.players as Player[] })
        break
      case 'ping': {
        const p = { ...(m as unknown as Ping), id: `${now}-${Math.random()}`, at: now }
        this.set({ pings: [...this.state.pings.filter((x) => now - x.at < 2500), p] })
        setTimeout(() => this.set({ pings: this.state.pings.filter((x) => x !== p) }), 2500)
        break
      }
      case 'draw': {
        const d = { ...(m as unknown as Drawing), until: now + Math.max(0, Number(m.until) - Date.now()) }
        this.set({ drawings: [...this.state.drawings.filter((x) => x.until > now), d] })
        setTimeout(() => this.set({ drawings: this.state.drawings.filter((x) => x !== d) }), d.until - now + 50)
        break
      }
      case 'request':
        this.set({ requests: [...this.state.requests.filter((r) => r.id !== m.id), m as unknown as MoveRequest] })
        break
      case 'decided':
        this.set({ requests: this.state.requests.filter((r) => r.id !== m.id) })
        break
      case 'roll':
        this.set({ rolls: [m as unknown as Roll, ...this.state.rolls].slice(0, 40) })
        break
      case 'error':
        this.set({ error: String(m.message) })
        break
    }
  }

  /** The DM's answer to a move request (accepting moves the token here first). */
  decide(req: MoveRequest, accept: boolean, move: (req: MoveRequest) => void) {
    if (accept) move(req)
    this.send({ t: 'decide', id: req.id, accept })
    this.set({ requests: this.state.requests.filter((r) => r.id !== req.id) })
  }

  ping(x: number, y: number) {
    this.send({ t: 'ping', x, y })
  }

  roll(expr: string, label: string, hidden: boolean) {
    this.send({ t: 'roll', expr, label, private: hidden })
  }
}

const lives = new Map<string, Live>()

/** The scene's live connection (kept while the app runs, so switching pages doesn't drop it). */
export function liveFor(sceneId: string, doc: Y.Doc, getSettings: () => SceneSettings, getTitle: () => string): Live {
  let l = lives.get(sceneId)
  if (!l) lives.set(sceneId, (l = new Live(sceneId, doc, getSettings, getTitle)))
  return l
}

export function useLive(live: Live | null): LiveState {
  return useSyncExternalStore(
    (l) => (live ? live.subscribe(l) : () => {}),
    () => (live ? live.state : IDLE),
  )
}
const IDLE = idle()
