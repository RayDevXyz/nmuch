import { Check, Dices, Eye, EyeOff, Search, Skull, Swords, User, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { charactersDb, getRoles, getSheet } from '../dnd/api'
import { search, type Entry } from '../dnd/fivee'
import { LiveSection, SubmissionsSection } from '../dnd/TablePanel'
import { getScene, setScene, useLive, type Initiative, type Live, type MoveRequest, type SceneSettings } from '../dnd/live'
import { toast, useApp } from '../state/store'
import { addElement, COLORS, deleteItems, updateElements, type Element, type Rect, type TokenEl, type XYWH } from './model'
import type { MapState } from '../battlemap/compute'
import { GenerateSection, LayersSection, LightingSection, LookSection, MapItemsSection } from '../battlemap/MapPanel'
import { LIGHT_PRESETS } from '../battlemap/tools'
import { tokenPath } from '../battlemap/fivee-art'
import { propSrc, type Asset } from '../battlemap/assets'

/**
 * A battle map (a page with the D&D role "scene"): the canvas plus a grid, fog of war, tokens,
 * and a live link to the table server players join. See `dnd/live.ts` for what players see.
 */

export const DEFAULT_SCENE: SceneSettings = {
  grid: { size: 70, offsetX: 0, offsetY: 0, show: true, color: '#000000', opacity: 0.35, feet: 5 },
  fog: true,
  room: null,
}

/** The scene's settings (kept in the page's props by the core). */
export function useSceneSettings(pageId: string, enabled: boolean) {
  const [settings, setSettings] = useState<SceneSettings | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void getScene(pageId).then(
      (s) => live && setSettings({ ...DEFAULT_SCENE, ...s, grid: { ...DEFAULT_SCENE.grid, ...s.grid } }),
      () => live && setSettings(DEFAULT_SCENE),
    )
    return () => {
      live = false
    }
  }, [pageId, enabled])
  const update = (patch: Partial<SceneSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    void setScene(pageId, patch).catch((e) => toast(String(e)))
  }
  return [settings, update] as const
}

/** Pointy-top hexes `size` across: the centre of the hex nearest (x, y). */
export function hexCenter(x: number, y: number, g: SceneSettings['grid']): [number, number] {
  const w = g.size
  const hh = (w * 2) / Math.sqrt(3)
  const dy = hh * 0.75
  const r0 = Math.round((y - g.offsetY - hh / 2) / dy)
  let best: [number, number] = [x, y]
  let bd = Infinity
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const cy = g.offsetY + hh / 2 + r * dy
    const shift = ((r % 2) + 2) % 2 ? w / 2 : 0
    const c = Math.round((x - g.offsetX - w / 2 - shift) / w)
    const cx = g.offsetX + w / 2 + shift + c * w
    const d = Math.hypot(cx - x, cy - y)
    if (d < bd) (bd = d), (best = [cx, cy])
  }
  return best
}

/** Where a token of `cells` cells sits when dropped near (x, y) (its top-left corner). */
export function snapToken(x: number, y: number, w: number, h: number, g: SceneSettings['grid']): [number, number] {
  if (g.type === 'none') return [Math.round(x), Math.round(y)]
  if (g.type === 'hex') {
    const [cx, cy] = hexCenter(x + w / 2, y + h / 2, g)
    return [Math.round(cx - w / 2), Math.round(cy - h / 2)]
  }
  const s = g.size
  const cx = x + w / 2
  const cy = y + h / 2
  const halfW = (Math.max(1, Math.round(w / s)) * s) / 2
  const halfH = (Math.max(1, Math.round(h / s)) * s) / 2
  return [Math.round((cx - g.offsetX - halfW) / s) * s + g.offsetX, Math.round((cy - g.offsetY - halfH) / s) * s + g.offsetY]
}

/** The area the fog and the grid cover: the map picture, else everything with room around it. */
export function sceneBounds(elements: Element[]): Rect {
  const img = elements.filter((e) => e.type === 'image').sort((a, b) => (b as { xywh: XYWH }).xywh[2] * (b as { xywh: XYWH }).xywh[3] - (a as { xywh: XYWH }).xywh[2] * (a as { xywh: XYWH }).xywh[3])[0] as
    | { xywh: XYWH }
    | undefined
  if (img) return { x: img.xywh[0], y: img.xywh[1], w: img.xywh[2], h: img.xywh[3] }
  return { x: -1400, y: -1000, w: 2800, h: 2000 }
}

const tokenColor = (t: TokenEl) => (t.color && COLORS[t.color]) || t.color || (t.player ? '#4f8fd8' : '#a34a3a')
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

// ---------- world-space layers (inside the canvas's transformed world)

/** Grid and fog under the tokens. The DM sees through the fog; players don't. */
export function SceneUnder({ elements, settings, selected, bounds }: { elements: Element[]; settings: SceneSettings; selected: Set<string>; bounds?: Rect }) {
  const b = bounds ?? sceneBounds(elements)
  const g = settings.grid
  const reveals = elements.filter((e): e is Extract<Element, { type: 'reveal' }> => e.type === 'reveal')
  const lines: string[] = []
  if (g.show && g.size >= 8 && g.type === 'hex') {
    // Pointy-top hexes, row by row.
    const w = g.size
    const hh = (w * 2) / Math.sqrt(3)
    const dy = hh * 0.75
    const r0 = Math.floor((b.y - g.offsetY) / dy) - 1
    const r1 = Math.ceil((b.y + b.h - g.offsetY) / dy)
    for (let r = r0; r <= r1 && lines.length < 4000; r++) {
      const cy = g.offsetY + hh / 2 + r * dy
      const shift = ((r % 2) + 2) % 2 ? w / 2 : 0
      const c0 = Math.floor((b.x - g.offsetX - shift) / w) - 1
      const c1 = Math.ceil((b.x + b.w - g.offsetX - shift) / w)
      for (let c = c0; c <= c1; c++) {
        const cx = g.offsetX + w / 2 + shift + c * w
        lines.push(`M${cx},${cy - hh / 2}L${cx + w / 2},${cy - hh / 4}L${cx + w / 2},${cy + hh / 4}L${cx},${cy + hh / 2}L${cx - w / 2},${cy + hh / 4}`)
      }
    }
  } else if (g.show && g.size >= 8 && g.type !== 'none') {
    const x0 = g.offsetX + Math.ceil((b.x - g.offsetX) / g.size) * g.size
    const y0 = g.offsetY + Math.ceil((b.y - g.offsetY) / g.size) * g.size
    for (let x = x0; x <= b.x + b.w && lines.length < 600; x += g.size) lines.push(`M${x},${b.y}V${b.y + b.h}`)
    for (let y = y0; y <= b.y + b.h && lines.length < 1200; y += g.size) lines.push(`M${b.x},${y}H${b.x + b.w}`)
  }
  const shape = (r: (typeof reveals)[number], fill: string, extra: React.SVGProps<SVGElement> = {}) =>
    r.points && r.points.length > 2 ? (
      <polygon key={r.id} points={r.points.map((p) => p.join(',')).join(' ')} fill={fill} {...(extra as React.SVGProps<SVGPolygonElement>)} />
    ) : (
      <rect key={r.id} x={r.xywh[0]} y={r.xywh[1]} width={r.xywh[2]} height={r.xywh[3]} fill={fill} {...(extra as React.SVGProps<SVGRectElement>)} />
    )
  return (
    <>
      <svg className="sc-layer" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} aria-hidden>
        {lines.length > 0 && <path strokeLinejoin="round" d={lines.join('')} stroke={g.color} strokeOpacity={g.opacity} strokeWidth={1.2} fill="none" />}
        {settings.fog && (
          <>
            <defs>
              <mask id="sc-fog-mask" maskUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.w} height={b.h}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="white" />
                {reveals.map((r) => shape(r, 'black'))}
              </mask>
            </defs>
            <rect className="sc-fog" x={b.x} y={b.y} width={b.w} height={b.h} mask="url(#sc-fog-mask)" />
            {reveals.map((r) => shape(r, 'none', { className: `sc-reveal ${selected.has(r.id) ? 'selected' : ''}` } as React.SVGProps<SVGElement>))}
          </>
        )}
      </svg>
      {settings.fog &&
        reveals.map((r) => (
          <span key={r.id} className={`sc-reveal-tag ${selected.has(r.id) ? 'selected' : ''}`} data-cid={r.id} style={{ left: r.xywh[0], top: r.xywh[1] }} title="A revealed area: drag to move, Del to fog it again">
            ◌
          </span>
        ))}
    </>
  )
}

/** Tokens, and what's happening at the table: pings, drawings, move requests. */
export function SceneOver({ elements, live, selected, pageId, assets }: { elements: Element[]; live: Live | null; selected: Set<string>; pageId: string; assets: Record<string, Asset> }) {
  const liveState = useLive(live)
  // Pings, drawings and requests belong to the map players see.
  const state = liveState.showing === pageId ? liveState : { ...liveState, requests: [], pings: [], drawings: [] }
  const tokens = elements.filter((e): e is TokenEl => e.type === 'token')
  const byId = new Map(tokens.map((t) => [t.id, t]))
  return (
    <>
      {tokens.map((t) => (
        <TokenView key={t.id} t={t} selected={selected.has(t.id)} picture={t.asset ? (propSrc(t.asset, assets)?.src ?? null) : null} />
      ))}
      {state.requests.map((r) => {
        const t = byId.get(r.token)
        if (!t) return null
        const [, , w, h] = t.xywh
        return <div key={r.id} className="sc-ghost" style={{ left: r.x - w / 2, top: r.y - h / 2, width: w, height: h, borderColor: r.color }} title={`${r.name} wants to move here`} />
      })}
      <svg className="sc-live" width="1" height="1" aria-hidden>
        {state.drawings.map((d) => (
          <polyline key={d.id} points={d.points.map((p) => p.join(',')).join(' ')} stroke={d.color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
        ))}
        {state.pings.map((p) => (
          <g key={p.id}>
            <circle className="sc-ping" cx={p.x} cy={p.y} r={18} stroke={p.color} />
            <circle cx={p.x} cy={p.y} r={6} fill={p.color} />
          </g>
        ))}
      </svg>
    </>
  )
}

function TokenView({ t, selected, picture }: { t: TokenEl; selected: boolean; picture: string | null }) {
  const [x, y, w, h] = t.xywh
  const page = useApp((s) => (t.page ? s.pages[t.page] : undefined))
  const name = t.text || page?.title || 'Creature'
  const hp = t.hp ?? null
  const max = t.maxHp ?? null
  const ratio = hp != null && max ? Math.max(0, Math.min(1, hp / max)) : null
  return (
    <div
      className={`sc-token ${selected ? 'selected' : ''} ${t.hidden ? 'hidden' : ''} ${t.player ? 'player' : ''} ${hp != null && hp <= 0 ? 'down' : ''}`}
      data-cid={t.id}
      style={{ left: x, top: y, width: w, height: h, ['--tc' as string]: tokenColor(t) }}
      title={`${name}${t.hidden ? ' (hidden from players)' : ''}`}
    >
      <span className={`sc-token-disc ${picture ? 'pictured' : ''}`} style={{ fontSize: Math.max(12, Math.min(w, h) * 0.34) }}>
        {picture ? <img src={picture} alt="" draggable={false} /> : initials(name)}
      </span>
      {t.hidden && <EyeOff className="sc-token-hidden" size={14} />}
      {ratio != null && (
        <span className="sc-token-hp">
          <i style={{ width: `${ratio * 100}%`, background: ratio > 0.5 ? '#6fae4f' : ratio > 0.25 ? '#d9a13b' : '#c0473a' }} />
        </span>
      )}
      <span className="sc-token-name">{name}</span>
    </div>
  )
}

// ---------- placing tokens

export type Pick = { name: string; page?: string; player?: boolean; hp?: number; maxHp?: number; ac?: number; cells: number; color?: string; art?: string }

const SIZE_CELLS: Record<string, number> = { T: 1, S: 1, M: 1, L: 2, H: 3, G: 4 }

/** A monster as a new token: its hit points, AC and size, and its 5etools token picture if it has one. */
export function monsterPick(e: Entry): Pick {
  const r = e.raw
  const hp = typeof r.hp?.average === 'number' ? r.hp.average : undefined
  const ac0 = Array.isArray(r.ac) ? r.ac[0] : r.ac
  const ac = typeof ac0 === 'number' ? ac0 : typeof ac0?.ac === 'number' ? ac0.ac : undefined
  const size = Array.isArray(r.size) ? r.size[0] : r.size
  return { name: e.name, hp, maxHp: hp, ac, cells: SIZE_CELLS[size as string] ?? 1, art: tokenPath(r) ?? undefined }
}

/** Choose what a new token is: one of the party, a monster from the compendium, or anything. */
export function TokenPicker({ at, onPick, onClose }: { at: { sx: number; sy: number }; onPick: (p: Pick) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'party' | 'monster' | 'custom'>('party')
  const [q, setQ] = useState('')
  const [monsters, setMonsters] = useState<Entry[]>([])
  const [error, setError] = useState('')
  const pages = useApp((s) => s.pages)
  const chars = charactersDb(getRoles())
  const party = useMemo(() => Object.values(pages).filter((p) => chars && p.databaseId === chars && !p.trashedAt), [pages, chars])
  useEffect(() => {
    if (tab !== 'monster') return
    let live = true
    search(q, ['monster'], 40).then(
      (r) => live && (setMonsters(r), setError('')),
      (e) => live && setError(`The compendium isn't reachable (${String(e)}). Set its address with Ctrl+Shift+D.`),
    )
    return () => {
      live = false
    }
  }, [q, tab])
  const pickCharacter = async (id: string, title: string) => {
    const s = await getSheet(id).catch(() => null)
    onPick({ name: title || 'Hero', page: id, player: true, hp: s?.hp.current, maxHp: s?.hp.max, ac: s?.ac, cells: 1 })
  }
  return (
    <div className="sc-picker" style={{ left: at.sx, top: at.sy }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && onClose())}>
      <div className="sc-picker-tabs">
        <button className={tab === 'party' ? 'on' : ''} onClick={() => setTab('party')}>
          <User size={13} /> Party
        </button>
        <button className={tab === 'monster' ? 'on' : ''} onClick={() => setTab('monster')}>
          <Skull size={13} /> Monster
        </button>
        <button className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>
          <Swords size={13} /> Other
        </button>
        <button className="sc-picker-close" aria-label="Close" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {tab === 'party' && (
        <ul className="sc-picker-list">
          {party.length === 0 && <li className="muted-text">No characters yet: make them in the Characters database.</li>}
          {party.map((p) => (
            <li key={p.id}>
              <button onClick={() => void pickCharacter(p.id, p.title)}>
                {p.icon ? `${p.icon} ` : ''}
                {p.title || 'Unnamed hero'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {tab === 'monster' && (
        <>
          <label className="sc-picker-search">
            <Search size={13} />
            <input autoFocus placeholder="Goblin, owlbear, adult red dragon…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && monsters[0] && onPick(monsterPick(monsters[0]))} />
          </label>
          {error && <p className="sc-error">{error}</p>}
          <ul className="sc-picker-list">
            {monsters.map((m) => (
              <li key={`${m.name}|${m.source}`}>
                <button onClick={() => onPick(monsterPick(m))}>
                  {m.name} <span className="muted-text">{m.source}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === 'custom' && <CustomToken onPick={onPick} />}
    </div>
  )
}

function CustomToken({ onPick }: { onPick: (p: Pick) => void }) {
  const [name, setName] = useState('')
  const [hp, setHp] = useState('')
  const [cells, setCells] = useState(1)
  const go = () => name.trim() && onPick({ name: name.trim(), hp: Number(hp) || undefined, maxHp: Number(hp) || undefined, cells })
  return (
    <div className="sc-custom">
      <input autoFocus placeholder="Name (Bandit captain, a chest, …)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <div className="sc-row">
        <input placeholder="HP" inputMode="numeric" value={hp} onChange={(e) => setHp(e.target.value.replace(/\D/g, ''))} />
        <select value={cells} onChange={(e) => setCells(Number(e.target.value))}>
          <option value={1}>1 square</option>
          <option value={2}>2×2 (large)</option>
          <option value={3}>3×3 (huge)</option>
          <option value={4}>4×4 (gargantuan)</option>
        </select>
        <button className="sc-btn gold" onClick={go}>
          Add
        </button>
      </div>
    </div>
  )
}

/** Add a token centered on (wx, wy), snapped to the grid. Monsters start hidden from players. */
export function placeToken(doc: Y.Doc, p: Pick, wx: number, wy: number, g: SceneSettings['grid']): string {
  const size = p.cells * g.size
  const [x, y] = snapToken(wx - size / 2, wy - size / 2, size, size, g)
  const same = p.page ? 0 : countNamed(doc, p.name)
  return addElement(doc, {
    type: 'token',
    xywh: [x, y, size, size],
    text: same ? `${p.name} ${same + 1}` : p.name,
    ...(p.page ? { page: p.page } : {}),
    player: !!p.player,
    hidden: !p.player,
    ...(p.hp != null ? { hp: p.hp } : {}),
    ...(p.maxHp != null ? { maxHp: p.maxHp } : {}),
    ...(p.ac != null ? { ac: p.ac } : {}),
    color: p.player ? 'blue' : 'red',
  })
}
function countNamed(doc: Y.Doc, name: string): number {
  let n = 0
  ;(doc.getMap('surface') as Y.Map<Y.Map<unknown>>).forEach((m) => {
    const t = m.get('text')
    if (m.get('type') === 'token' && typeof t === 'string' && (t === name || t.startsWith(`${name} `))) n++
  })
  return n
}

// ---------- the scene panel (screen space, on the right)

export type ScenePanelProps = Omit<Parameters<typeof ScenePanel>[0], 'tab'>

/** The battle map's settings, shown in the right panel: its Table tab (live) or its Map tab. */
export function ScenePanel({
  tab,
  pageId,
  doc,
  elements,
  settings,
  onSettings,
  selected,
  onSelect,
  live,
  onShow,
  mapState,
  playerView,
  onPlayerView,
  viewCenter,
  onFit,
}: {
  tab: 'table' | 'map'
  pageId: string
  onShow: () => void
  mapState: MapState | null
  playerView: boolean
  onPlayerView: (on: boolean) => void
  viewCenter: () => [number, number]
  onFit: () => void
  doc: Y.Doc
  elements: Element[]
  settings: SceneSettings
  onSettings: (patch: Partial<SceneSettings>) => void
  selected: string[]
  onSelect: (ids: string[]) => void
  live: Live
}) {
  const liveState = useLive(live)
  const state = liveState.showing === pageId ? liveState : { ...liveState, requests: [] }
  const tokens = elements.filter((e): e is TokenEl => e.type === 'token')
  const picked = tokens.filter((t) => selected.includes(t.id))
  const title = useApp((s) => s.pages[pageId]?.title) || 'Battle map'
  const campaignTitle = useApp((s) => s.pages[live.campaignId]?.title)

  const moveFor = (req: MoveRequest) => {
    const t = tokens.find((x) => x.id === req.token)
    if (!t) return
    const [, , w, h] = t.xywh
    updateElements(doc, { [t.id]: { xywh: [Math.round(req.x - w / 2), Math.round(req.y - h / 2), w, h] } })
  }

  return (
    <div className="sc-panel rp-scene" onKeyDown={(e) => e.stopPropagation()}>
      {picked.length > 0 && <TokenSection doc={doc} tokens={picked} grid={settings.grid} />}
      <MapItemsSection doc={doc} items={elements.filter((e) => selected.includes(e.id))} />
      {tab === 'map' && (
        <>
          <GenerateSection doc={doc} settings={settings} elements={elements} viewCenter={viewCenter} onDone={(ids) => (onSelect([]), void ids, onFit())} onSettings={onSettings} pageId={pageId} />
          <LookSection settings={settings} onSettings={onSettings} />
          <LayersSection settings={settings} onSettings={onSettings} elements={elements} onSelect={onSelect} />
          <LightingSection settings={settings} onSettings={onSettings} doc={doc} playerView={playerView} onPlayerView={onPlayerView} state={mapState} />
          <MapSection doc={doc} elements={elements} settings={settings} onSettings={onSettings} bounds={mapState?.bounds} />
        </>
      )}
      {tab === 'table' && (
        <>
      <LiveSection live={live} title={campaignTitle || title} sceneId={pageId} onShow={onShow} />
      <SubmissionsSection live={live} campaignId={live.campaignId} />
      {state.requests.length > 0 && (
        <section className="sc-sec">
          <h3>Move requests</h3>
          {state.requests.map((r) => {
            const t = tokens.find((x) => x.id === r.token)
            return (
              <div key={r.id} className="sc-request">
                <i style={{ background: r.color }} />
                <span>
                  <b>{r.name}</b> moves {t?.text || 'their token'}
                </span>
                <button className="sc-icon ok" title="Accept: the token moves" onClick={() => live.decide(r, true, moveFor)}>
                  <Check size={14} />
                </button>
                <button className="sc-icon no" title="Decline" onClick={() => live.decide(r, false, moveFor)}>
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </section>
      )}
      <InitiativeSection settings={settings} onSettings={onSettings} tokens={tokens} onSelect={onSelect} />
      <DiceSection live={live} />
        </>
      )}
    </div>
  )
}

function TokenSection({ doc, tokens, grid }: { doc: Y.Doc; tokens: TokenEl[]; grid: SceneSettings['grid'] }) {
  const one = tokens.length === 1 ? tokens[0] : null
  const set = (patch: Record<string, unknown>) => updateElements(doc, Object.fromEntries(tokens.map((t) => [t.id, patch])))
  const allHidden = tokens.every((t) => t.hidden)
  const [delta, setDelta] = useState('')
  const applyDelta = (sign: 1 | -1) => {
    const n = Number(delta)
    if (!n) return
    updateElements(doc, Object.fromEntries(tokens.map((t) => [t.id, { hp: Math.max(0, Math.min(t.maxHp ?? Infinity, (t.hp ?? 0) + sign * n)) }])))
    setDelta('')
  }
  return (
    <section className="sc-sec">
      <h3>{one ? one.text || 'Token' : `${tokens.length} tokens`}</h3>
      {one && (
        <div className="sc-grid2">
          <label>
            Name
            <input className="sc-input" value={one.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <label>
            AC
            <input className="sc-input" inputMode="numeric" value={one.ac ?? ''} onChange={(e) => set({ ac: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          </label>
          <label>
            HP
            <input className="sc-input" inputMode="numeric" value={one.hp ?? ''} onChange={(e) => set({ hp: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          </label>
          <label>
            Max HP
            <input className="sc-input" inputMode="numeric" value={one.maxHp ?? ''} onChange={(e) => set({ maxHp: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          </label>
        </div>
      )}
      <div className="sc-row">
        <input className="sc-input" style={{ width: 70 }} placeholder="±HP" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && applyDelta(-1)} />
        <button className="sc-btn" title="Damage (Enter)" onClick={() => applyDelta(-1)}>
          − Damage
        </button>
        <button className="sc-btn" title="Heal" onClick={() => applyDelta(1)}>
          + Heal
        </button>
      </div>
      {one && (
        <div className="sc-grid2">
          <label title="How far it sees (empty: as far as there's light)">
            Sight (ft)
            <input className="sc-input" inputMode="numeric" placeholder="∞" value={one.sight ?? ''} onChange={(e) => set({ sight: Number(e.target.value.replace(/\D/g, '')) || undefined })} />
          </label>
          <label title="Sees in the dark this far (in grey)">
            Darkvision (ft)
            <input className="sc-input" inputMode="numeric" placeholder="0" value={one.darkvision ?? ''} onChange={(e) => set({ darkvision: Number(e.target.value.replace(/\D/g, '')) || undefined })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Carries
            <select
              className="sc-input"
              value={one.light ? (Object.entries(LIGHT_PRESETS).find(([, p]) => p.light.bright === one.light!.bright && p.light.color === one.light!.color)?.[0] ?? 'custom') : ''}
              onChange={(e) => e.target.value !== 'custom' && set({ light: LIGHT_PRESETS[e.target.value] ? { ...LIGHT_PRESETS[e.target.value].light } : undefined })}
            >
              <option value="">No light</option>
              {Object.entries(LIGHT_PRESETS).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
              {one.light && !Object.values(LIGHT_PRESETS).some((p) => p.light.bright === one.light!.bright && p.light.color === one.light!.color) && <option value="custom">Its own light</option>}
            </select>
          </label>
        </div>
      )}
      <div className="sc-row">
        <button className={`sc-btn ${allHidden ? 'on' : ''}`} onClick={() => set({ hidden: !allHidden })} title="Hidden tokens are never sent to players">
          {allHidden ? <EyeOff size={13} /> : <Eye size={13} />} {allHidden ? 'Hidden' : 'Visible'}
        </button>
        {one && (
          <button className={`sc-btn ${one.player ? 'on' : ''}`} onClick={() => set(one.player ? { player: false } : { player: true, hidden: false })} title="Players can claim and move player characters; they see their hit points">
            <User size={13} /> {one.player ? 'Player character' : 'Creature'}
          </button>
        )}
        {one && (
          <select
            className="sc-input"
            style={{ width: 'auto' }}
            title="Size in squares"
            value={Math.max(1, Math.round(one.xywh[2] / grid.size))}
            onChange={(e) => {
              const n = Number(e.target.value) * grid.size
              const [x, y] = one.xywh
              updateElements(doc, { [one.id]: { xywh: [x, y, n, n] } })
            }}
          >
            <option value={1}>1×1</option>
            <option value={2}>2×2</option>
            <option value={3}>3×3</option>
            <option value={4}>4×4</option>
          </select>
        )}
      </div>
    </section>
  )
}

function InitiativeSection({
  settings,
  onSettings,
  tokens,
  onSelect,
}: {
  settings: SceneSettings
  onSettings: (patch: Partial<SceneSettings>) => void
  tokens: TokenEl[]
  onSelect: (ids: string[]) => void
}) {
  const ini: Initiative = settings.initiative ?? { round: 1, turn: 0, entries: [] }
  const save = (next: Initiative) => onSettings({ initiative: next })
  const sorted = (entries: Initiative['entries']) => [...entries].sort((a, b) => (b.init ?? -99) - (a.init ?? -99))
  const addAll = () => {
    const have = new Set(ini.entries.map((e) => e.token))
    const add = tokens
      .filter((t) => !have.has(t.id))
      .map((t) => ({ id: t.id, name: t.text || 'Creature', token: t.id, init: t.player ? null : Math.floor(Math.random() * 20) + 1 }))
    save({ ...ini, entries: sorted([...ini.entries, ...add]) })
  }
  const next = () => {
    if (!ini.entries.length) return
    const turn = ini.turn + 1
    save(turn >= ini.entries.length ? { ...ini, turn: 0, round: ini.round + 1 } : { ...ini, turn })
  }
  const current = ini.entries[ini.turn]
  return (
    <section className="sc-sec">
      <h3>
        Initiative {ini.entries.length > 0 && <small>round {ini.round}</small>}
      </h3>
      {ini.entries.length === 0 ? (
        <p className="sc-hint">Add the tokens on the map, type the players' rolls, then step through the turns. Players see the order (without hidden creatures).</p>
      ) : (
        <ol className="sc-ini">
          {ini.entries.map((e, i) => (
            <li key={e.id} className={i === ini.turn ? 'turn' : ''}>
              <input
                className="sc-ini-roll"
                inputMode="numeric"
                value={e.init ?? ''}
                placeholder="–"
                onChange={(ev) => save({ ...ini, entries: ini.entries.map((x) => (x.id === e.id ? { ...x, init: ev.target.value === '' ? null : Number(ev.target.value.replace(/[^\d-]/g, '')) || 0 } : x)) })}
                onBlur={() => save({ ...ini, entries: sorted(ini.entries), turn: Math.max(0, sorted(ini.entries).findIndex((x) => x.id === current?.id)) })}
              />
              <button className="sc-ini-name" onClick={() => e.token && onSelect([e.token])}>
                {e.name}
                {tokens.find((t) => t.id === e.token)?.hidden ? <EyeOff size={11} /> : null}
              </button>
              <button className="sc-icon" aria-label={`Remove ${e.name}`} onClick={() => save({ ...ini, entries: ini.entries.filter((x) => x.id !== e.id), turn: Math.min(ini.turn, Math.max(0, ini.entries.length - 2)) })}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="sc-row">
        <button className="sc-btn" onClick={addAll}>
          Add tokens
        </button>
        {ini.entries.length > 0 && (
          <>
            <button className="sc-btn gold" onClick={next}>
              Next turn
            </button>
            <button className="sc-btn" onClick={() => save({ round: 1, turn: 0, entries: [] })}>
              End fight
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function DiceSection({ live }: { live: Live }) {
  const state = useLive(live)
  const [expr, setExpr] = useState('')
  const [secret, setSecret] = useState(true)
  if (state.status !== 'live') return null
  const roll = (e: string) => e.trim() && live.roll(e.trim(), '', secret)
  return (
    <section className="sc-sec">
      <h3>
        <Dices size={13} /> Dice
      </h3>
      <div className="sc-dice">
        {['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'].map((d) => (
          <button key={d} className="sc-btn" onClick={() => roll(`1${d}`)}>
            {d}
          </button>
        ))}
      </div>
      <div className="sc-row">
        <input className="sc-input" placeholder="2d6+3, d20 adv…" value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (roll(expr), setExpr(''))} />
        <label className="sc-check" title="Only you see secret rolls">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> secret
        </label>
      </div>
      <ul className="sc-rolls">
        {state.rolls.slice(0, 12).map((r, i) => (
          <li key={`${r.at}-${i}`}>
            <b>{r.total}</b>
            <span style={{ color: r.color }}>{r.name}</span> {r.label ? `· ${r.label} ` : ''}
            {r.private ? <em>(secret)</em> : null}
            <small>
              {r.expr}: {r.detail}
            </small>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MapSection({ doc, elements, settings, onSettings, bounds }: { doc: Y.Doc; elements: Element[]; settings: SceneSettings; onSettings: (patch: Partial<SceneSettings>) => void; bounds?: Rect }) {
  const g = settings.grid
  const grid = (patch: Partial<SceneSettings['grid']>) => onSettings({ grid: { ...g, ...patch } })
  const reveals = elements.filter((e) => e.type === 'reveal')
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
  }
  return (
    <section className="sc-sec">
      <h3>Grid & fog</h3>
      <div className="sc-grid2">
        <label>
          Square (px)
          <input className="sc-input" type="number" min={8} max={500} value={g.size} onChange={(e) => grid({ size: num(e.target.value, 8, 500, g.size) })} />
        </label>
        <label>
          Feet per square
          <input className="sc-input" type="number" min={1} value={g.feet} onChange={(e) => grid({ feet: num(e.target.value, 1, 100, 5) })} />
        </label>
        <label>
          Shift x
          <input className="sc-input" type="number" value={g.offsetX} onChange={(e) => grid({ offsetX: num(e.target.value, -500, 500, 0) })} />
        </label>
        <label>
          Shift y
          <input className="sc-input" type="number" value={g.offsetY} onChange={(e) => grid({ offsetY: num(e.target.value, -500, 500, 0) })} />
        </label>
      </div>
      <div className="sc-row">
        <label className="sc-check">
          <input type="checkbox" checked={g.show} onChange={(e) => grid({ show: e.target.checked })} /> grid
        </label>
        <input type="range" min={0.05} max={1} step={0.05} value={g.opacity} onChange={(e) => grid({ opacity: Number(e.target.value) })} title="Grid strength" />
        <input type="color" value={g.color} onChange={(e) => grid({ color: e.target.value })} title="Grid color" />
      </div>
      <div className="sc-row">
        <label className="sc-check">
          <input type="checkbox" checked={settings.fog} onChange={(e) => onSettings({ fog: e.target.checked })} /> fog of war
        </label>
        {settings.fog && (
          <>
            <button
              className="sc-btn"
              title="Clear the fog from the whole map"
              onClick={() => {
                const b = bounds ?? sceneBounds(elements)
                addElement(doc, { type: 'reveal', xywh: [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)] })
              }}
            >
              Reveal all
            </button>
            <button className="sc-btn" disabled={!reveals.length} title="Fog the whole map again" onClick={() => deleteItems(doc, new Set(reveals.map((r) => r.id)))}>
              Fog all
            </button>
          </>
        )}
      </div>
      <p className="sc-hint">Reveal tool (E): drag over what the players can see (with line of sight on, they also see what their characters see). Token tool (K): click to place. Alt-click pings everyone.</p>
    </section>
  )
}

