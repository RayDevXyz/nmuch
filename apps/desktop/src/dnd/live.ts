import { useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { coreClient } from '../lib/storage'
import { getState } from '../state/store'
import { COLORS, readElements, type Element } from '../edgeless/model'
import { computeMap, type MapState } from '../battlemap/compute'
import { pointIn, tidy } from '../battlemap/geom'
import { readExplored } from '../battlemap/lighting'
import { layerOf } from '../battlemap/model'
import { lookOf, renderArchitecture, renderTerrain, svgDocument } from '../battlemap/render'
import { propSrc, readAssets } from '../battlemap/assets'

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
 *
 * A campaign has one room (one link for the players); the DM shows one battle map on it at a
 * time. The connection also carries the campaign's character rules (the options players build
 * characters from), the party's sheets, and the characters players submit for approval.
 */

export interface SceneSettings {
  /** `type`: squares (the default), hexes, or no grid at all (tokens move freely). */
  grid: { size: number; offsetX: number; offsetY: number; show: boolean; color: string; opacity: number; feet: number; type?: 'square' | 'hex' | 'none' }
  fog: boolean
  /** The drawn map: theme and layers (see `battlemap/model.ts`). */
  map?: Partial<import('../battlemap/model').MapSettings>
  /** Ambient light and the players' line of sight. */
  lighting?: Partial<import('../battlemap/model').LightingSettings>
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

/** What players may build characters from, set per campaign. */
export interface CharacterRules {
  level: number
  /** How ability scores are made: one method, or the player's choice. */
  method: 'any' | 'standard' | 'pointbuy' | 'manual'
  /** 5etools sources allowed (null: all). */
  sources: string[] | null
  /** Shown to players above the form. */
  note: string
  /** Whether players may submit characters now. */
  open: boolean
}
export interface CampaignTable {
  room: string | null
  rules: CharacterRules
}
export const getCampaignTable = (id: string) => coreClient().call<CampaignTable>('dndCampaignTable', { id })
export const setCampaignTable = (id: string, patch: Partial<CampaignTable>) => coreClient().call<CampaignTable>('dndSetCampaignTable', { id, sheet: patch })

/** A character a player built on the table site. */
export interface Submission {
  id: string
  player: string
  status: 'pending' | 'returned' | 'approved'
  note: string
  at: number
  characterId?: string
  character: {
    name: string
    race: { name: string; source: string } | null
    class: { name: string; source: string } | null
    background: { name: string; source: string } | null
    method: string
    base: Record<string, number>
    skills: string[]
    alignment?: string
    backstory?: string
  }
}

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
  /** Characters waiting for the DM. */
  submissions: Submission[]
  /** The battle map players see (null: none). */
  showing: string | null
}

const idle = (): LiveState => ({ status: 'off', players: [], pings: [], drawings: [], requests: [], rolls: [], submissions: [], showing: null })

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

/** One thing players draw, in order: a picture (the map's layers, props), or the ground's colour. */
export interface Drawn {
  kind: 'img' | 'rect'
  hash?: string
  /** A moving picture (GIF, APNG…) or a video: drawn every frame. */
  anim?: 'img' | 'video'
  x: number
  y: number
  w: number
  h: number
  rotate?: number
  flip?: boolean
  opacity?: number
  filter?: string
  color?: string
}

/** The map's drawn layers as players get them, and the pictures they need (by hash). */
export async function mapForPlayers(elements: Element[], settings: SceneSettings, state: MapState, doc: Y.Doc | null): Promise<{ layers: Drawn[]; files: Map<string, string> }> {
  const files = new Map<string, string>()
  const layers: Drawn[] = []
  const assets = doc ? readAssets(doc) : {}
  const look = lookOf(state.map.theme, settings.grid.size)
  const b = state.bounds
  const add = async (src: string): Promise<string> => {
    const hit = await hashed(src)
    files.set(hit.hash, hit.data)
    return hit.hash
  }
  /** The drawn layers' pictures, made again only when the drawing (or its look) changes. */
  const drawnSvg = (which: 'terrain' | 'arch'): string => {
    let per = svgs.get(state.built)
    if (!per) svgs.set(state.built, (per = new Map()))
    const key = `${which}|${state.map.theme}|${settings.grid.size}|${b.x},${b.y},${b.w},${b.h}`
    let url = per.get(key)
    if (url === undefined) {
      const r = which === 'terrain' ? renderTerrain(state.built, opts) : renderArchitecture(state.built, opts)
      url = r.body ? svgUrl(svgDocument(r.defs, r.body, b, svgScale(b))) : ''
      per.set(key, url)
    }
    return url
  }
  const items = async (layer: string, kinds: string[]) => {
    for (const e of elements) {
      if (e.visible === false || layerOf(e) !== layer || !kinds.includes(e.type)) continue
      if (e.type === 'image') layers.push({ kind: 'img', hash: await add(e.src), x: e.xywh[0], y: e.xywh[1], w: e.xywh[2], h: e.xywh[3], rotate: e.rotate, opacity: e.opacity })
      else if (e.type === 'prop') {
        const src = propSrc(e.asset, assets)
        if (!src) continue
        layers.push({
          kind: 'img',
          hash: await add(src.src),
          ...(src.video ? { anim: 'video' as const } : src.animated ? { anim: 'img' as const } : {}),
          x: e.xywh[0],
          y: e.xywh[1],
          w: e.xywh[2],
          h: e.xywh[3],
          rotate: e.rotate,
          flip: e.flip,
          opacity: e.opacity,
          filter: look.propFilter || undefined,
        })
      }
    }
  }
  const opts = { theme: state.map.theme, grid: settings.grid.size, idp: 'p', dm: false }
  for (const layer of state.map.layers.order) {
    if (state.hidden.has(layer) || layer === 'gm' || layer === 'tokens') continue
    if (layer === 'terrain') {
      if (state.drawn) layers.push({ kind: 'rect', color: look.ground, x: b.x, y: b.y, w: b.w, h: b.h })
      await items('terrain', ['image'])
      const t = drawnSvg('terrain')
      if (t) layers.push({ kind: 'img', hash: await add(t), x: b.x, y: b.y, w: b.w, h: b.h })
      await items('terrain', ['prop'])
    } else if (layer === 'architecture') {
      const a = drawnSvg('arch')
      if (a) layers.push({ kind: 'img', hash: await add(a), x: b.x, y: b.y, w: b.w, h: b.h })
      await items('architecture', ['image', 'prop'])
    } else await items(layer, ['image', 'prop'])
  }
  return { layers, files }
}

const hashes = new Map<string, { hash: string; data: string }>()
/** A picture as the table keeps it (a base64 data URL) and its hash, worked out once. */
async function hashed(src: string): Promise<{ hash: string; data: string }> {
  let hit = hashes.get(src)
  if (!hit) {
    const data = toBase64(src)
    hit = { hash: await sha256(data), data }
    if (hashes.size > 400) hashes.clear()
    hashes.set(src, hit)
  }
  return hit
}
const svgs = new WeakMap<object, Map<string, string>>()

/** Big enough to stay sharp when players zoom in, small enough for a browser to draw. */
const svgScale = (b: { w: number; h: number }) => Math.max(0.5, Math.min(2, 8192 / Math.max(b.w, b.h)))
const svgUrl = (svg: string) => `data:image/svg+xml;base64,${utf8Base64(svg)}`
function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
/** The table keeps pictures as base64 data URLs. */
function toBase64(src: string): string {
  if (src.includes(';base64,')) return src
  const m = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(src)
  return m ? `data:${m[1]};base64,${utf8Base64(decodeURIComponent(m[2]))}` : src
}

/** The player-safe view of a scene. Exported for tests: what must never leave is decided here. */
export function project(elements: Element[], settings: SceneSettings, title: string, imageHash: string | null, state?: MapState | null, explored?: import('../battlemap/geom').Multi) {
  const reveals = elements.filter((e): e is Element & { type: 'reveal' } => e.type === 'reveal')
  const image = elements.filter((e) => e.type === 'image').sort((a, b) => area(b) - area(a))[0] as (Element & { type: 'image' }) | undefined
  const sight = state?.vision ?? null
  const visible = (e: Element & { type: 'token' }) => {
    if (e.hidden) return false
    if (state && state.hidden.has('tokens')) return false
    // The party always sees itself; other creatures only where the fog is cleared, or (with
    // line of sight) where a character sees them.
    if (e.player) return true
    if (!settings.fog && !sight) return true
    const [x, y, w, h] = e.xywh
    const c: [number, number] = [x + w / 2, y + h / 2]
    if (settings.fog && reveals.some((r) => inside(c[0], c[1], r))) return true
    if (sight) return pointIn(c, sight.visible)
    return !settings.fog
  }
  const tokens = elements
    .filter((e): e is Element & { type: 'token' } => e.type === 'token')
    .filter(visible)
    .map((t) => {
      const [x, y, w, h] = t.xywh
      const base = { id: t.id, name: t.text || 'Creature', x, y, w, h, color: (t.color && COLORS[t.color]) || t.color || (t.player ? '#4f8fd8' : '#a34a3a'), player: !!t.player }
      // A player character's page lets its player's browser find (and claim) its token.
      if (t.player) return { ...base, hp: t.hp ?? null, maxHp: t.maxHp ?? null, page: t.page ?? null }
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
    ...(state
      ? {
          bounds: state.bounds,
          ambient: state.lighting.ambient,
          // Lights whose owner players can't see (a hidden monster's torch) give nothing away.
          lights: state.lit.filter((l) => !l.secret).map((l) => ({ x: Math.round(l.x), y: Math.round(l.y), bright: Math.round(l.bright), dim: Math.round(l.dim), color: l.color, flicker: l.flicker, area: tidy(l.area, 1) })),
          vision: sight ? { visible: tidy(sight.visible, 1), explored: state.lighting.explored ? (explored ?? []) : [] } : null,
        }
      : {}),
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

// ---- the connection (one per campaign)

/** The battle map shown at the table. */
export interface Shown {
  sceneId: string
  doc: Y.Doc
  getSettings: () => SceneSettings
  getTitle: () => string
}


/**
 * Make (or re-open) a room on the table server. BrainWaves' own server (or the desktop app's
 * core) asks, so the browser makes no cross-site request: a reverse proxy that mishandles the
 * browser's CORS check can't break it. Only when that side can't reach the table server is the
 * request made from the browser.
 */
export async function createRoom(server: string, key: string, body: { name: string; code?: string }): Promise<string> {
  try {
    const r = await coreClient().call<{ code: string }>('tableCreateRoom', { server, key, ...body })
    return r.code
  } catch (e) {
    const m = String(e).replace(/^Error:\s*/, '')
    if (!m.startsWith('unreachable:') && !m.includes('unknown command')) throw new Error(m)
  }
  const res = await fetch(`${server}/api/rooms`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw new Error('The table server refused the DM key.')
  if (!res.ok) throw new Error(`The table server answered ${res.status}.`)
  return (await res.json()).code
}

export class Live {
  state: LiveState = idle()
  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  private stop: (() => void) | null = null
  private shown: Shown | null = null
  private sent = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private partyTimer: ReturnType<typeof setInterval> | undefined
  private lastParty = ''
  private closing = false

  constructor(readonly campaignId: string) {}

  subscribe = (l: () => void) => (this.listeners.add(l), () => this.listeners.delete(l))
  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** Make (or re-open) the campaign's room and connect as the DM. */
  async start(table: Table, roomName: string): Promise<string> {
    this.closing = false
    this.set({ status: 'connecting', error: undefined })
    const server = table.server.replace(/\/+$/, '')
    let code: string
    try {
      const t = await getCampaignTable(this.campaignId)
      const body = { name: roomName, code: t.room ?? undefined }
      code = await createRoom(server, table.key, body)
      if (t.room !== code) await setCampaignTable(this.campaignId, { room: code })
    } catch (e) {
      // A TypeError is the browser refusing or failing the request: the server is down, or
      // something in front of it (a login page, a proxy error) answers without CORS headers.
      const msg =
        e instanceof TypeError
          ? `Can't reach the table server at ${server}. Open ${server}/health in a new tab: it should say "ok". If it shows a login page, turn off "Authentication required" for that URL in your reverse proxy; if it shows an error, check the URL's target and that the table container is running.`
          : String(e).replace(/^Error:\s*/, '')
      this.set({ status: 'error', error: msg })
      throw new Error(msg)
    }
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
      this.lastParty = ''
      this.watch()
      void this.push()
      void this.pushRules()
      void this.pushParty()
      // Sheets change in BrainWaves (hit points, level ups): keep the players' copies fresh.
      clearInterval(this.partyTimer)
      this.partyTimer = setInterval(() => void this.pushParty(), 15000)
    }
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data))
    ws.onclose = () => {
      this.unwatch()
      clearInterval(this.partyTimer)
      if (this.closing) return this.set({ ...idle(), room: this.state.room, joinUrl: this.state.joinUrl, showing: this.state.showing })
      this.set({ status: 'connecting', error: 'Connection lost, reconnecting…' })
      setTimeout(() => !this.closing && this.connect(server, key, code), 2500)
    }
  }

  end() {
    this.closing = true
    this.unwatch()
    clearInterval(this.partyTimer)
    this.ws?.close()
    this.ws = null
    this.set({ ...idle(), room: this.state.room, joinUrl: this.state.joinUrl, showing: this.state.showing })
  }

  /** Show this battle map to the players (instead of the one before). */
  show(s: Shown) {
    const changed = this.shown?.sceneId !== s.sceneId
    this.unwatch()
    this.shown = s
    if (changed) this.set({ showing: s.sceneId, requests: [], pings: [], drawings: [] })
    if (this.state.status === 'live') {
      this.watch()
      void this.push()
    }
  }
  /** The shown map's page opened again (its doc may be a new one). */
  rebind(s: Shown) {
    if (this.shown?.sceneId === s.sceneId && (this.shown.doc !== s.doc || !this.stop)) this.show(s)
    else if (this.shown?.sceneId === s.sceneId) this.shown = s
  }
  /** Players see no map. */
  hide() {
    this.unwatch()
    this.shown = null
    this.set({ showing: null, requests: [] })
    this.send({ t: 'scene', scene: {} })
  }

  /** Push again when the shown map changes (debounced). */
  private watch() {
    if (!this.shown) return
    const doc = this.shown.doc
    const surface = doc.getMap('surface')
    const extra = [doc.getMap('mapState'), doc.getMap('mapAssets')]
    const changed = () => this.schedule()
    surface.observeDeep(changed)
    extra.forEach((m) => m.observe(changed))
    this.stop = () => (surface.unobserveDeep(changed), extra.forEach((m) => m.unobserve(changed)))
  }
  private unwatch() {
    this.stop?.()
    this.stop = null
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
    const shown = this.shown
    if (!shown) return this.send({ t: 'scene', scene: {} })
    const elements = readElements(shown.doc)
    const settings = shown.getSettings()
    const image = elements.filter((e) => e.type === 'image').sort((a, b) => area(b) - area(a))[0] as (Element & { type: 'image' }) | undefined
    let hash: string | null = null
    if (image) {
      hash = await sha256(image.src)
      if (!this.sent.has(hash)) {
        this.send({ t: 'image', hash, data: image.src })
        this.sent.add(hash)
      }
    }
    // The drawn map: its layers as pictures (each sent once), light and sight.
    const state = computeMap(elements, settings)
    const { layers, files } = await mapForPlayers(elements, settings, state, shown.doc)
    for (const [h, data] of files) {
      if (this.sent.has(h)) continue
      this.send({ t: 'image', hash: h, data })
      this.sent.add(h)
    }
    const scene = project(elements, settings, shown.getTitle(), hash, state, readExplored(shown.doc))
    // Tokens' pictures (5etools tokens, your own), each sent once.
    const assets = readAssets(shown.doc)
    for (const t of scene.tokens as { id: string; img?: string }[]) {
      const el = elements.find((e) => e.id === t.id)
      const src = el?.type === 'token' && el.asset ? propSrc(el.asset, assets) : null
      if (!src) continue
      const { hash: h, data } = await hashed(src.src)
      if (!this.sent.has(h)) {
        this.send({ t: 'image', hash: h, data })
        this.sent.add(h)
      }
      t.img = h
    }
    this.send({ t: 'scene', scene: { ...scene, layers } })
  }

  /** Send the campaign's character rules, with the options they allow. */
  async pushRules() {
    if (this.state.status !== 'live') return
    const { rules } = await getCampaignTable(this.campaignId)
    const { ruleOptions } = await import('./tableCharacters')
    this.send({ t: 'rules', rules: { ...rules, ...(await ruleOptions(rules)) } })
  }

  /** Send the party's sheets (only when they changed). */
  async pushParty() {
    if (this.state.status !== 'live') return
    const { loadParty } = await import('./tableCharacters')
    const party = await loadParty(this.campaignId).catch(() => null)
    if (!party) return
    const json = JSON.stringify(party)
    if (json === this.lastParty) return
    this.lastParty = json
    this.send({ t: 'party', party })
  }

  private onMessage(m: Record<string, unknown> & { t: string }) {
    const now = Date.now()
    switch (m.t) {
      case 'welcome':
        this.set({
          requests: (m.requests as MoveRequest[]) ?? [],
          rolls: ((m.rolls as Roll[]) ?? []).slice(-30).reverse(),
          submissions: (m.submissions as Submission[]) ?? [],
        })
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
      case 'submission': {
        const sub = m.submission as Submission
        this.set({ submissions: [...this.state.submissions.filter((x) => x.id !== sub.id), sub] })
        break
      }
      case 'withdrawn':
        this.set({ submissions: this.state.submissions.filter((x) => x.id !== m.id) })
        break
      case 'reviewed': {
        const sub = m.submission as Submission
        this.set({ submissions: this.state.submissions.filter((x) => x.id !== sub.id) })
        break
      }
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

  /** Approve a character (once BrainWaves made it: `characterId`) or send it back with a note. */
  review(sub: Submission, approve: boolean, note: string, characterId?: string) {
    this.send({ t: 'review', id: sub.id, approve, note, characterId })
    this.set({ submissions: this.state.submissions.filter((x) => x.id !== sub.id) })
    if (approve) {
      this.lastParty = ''
      void this.pushParty()
    }
  }

  ping(x: number, y: number) {
    this.send({ t: 'ping', x, y })
  }

  roll(expr: string, label: string, hidden: boolean) {
    this.send({ t: 'roll', expr, label, private: hidden })
  }
}

const lives = new Map<string, Live>()

/** The campaign's live connection (kept while the app runs, so switching pages doesn't drop it). */
export function liveFor(campaignId: string): Live {
  let l = lives.get(campaignId)
  if (!l) lives.set(campaignId, (l = new Live(campaignId)))
  return l
}

/** The campaign a battle map belongs to (its parent page). */
export const campaignOf = (sceneId: string): string | null => getState().pages[sceneId]?.parentId ?? null

export function useLive(live: Live | null): LiveState {
  return useSyncExternalStore(
    (l) => (live ? live.subscribe(l) : () => {}),
    () => (live ? live.state : IDLE),
  )
}
const IDLE = idle()
