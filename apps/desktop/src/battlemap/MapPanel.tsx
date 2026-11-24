import { ArrowDown, ArrowUp, Eye, EyeOff, FlipHorizontal2, Lock, Unlock, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type * as Y from 'yjs'
import { addElement, CANVAS, deleteItems, type AreaEl, type Element, type Light, type LightEl, type MapLayer, type PropEl, type WallEl } from '../edgeless/model'
import type { SceneSettings } from '../dnd/live'
import { toast } from '../state/store'
import { mapSettings, lightingSettings, type MapState } from './compute'
import { forget } from './lighting'
import { FLOORS, LAYERS, layerOf, OPENINGS, TERRAIN, THEMES, type MapSettings } from './model'
import { builtinById } from './props'
import { LIGHT_PRESETS } from './tools'
import { BIOMES, generate, type Biome, type Size } from './generate'
import { updateElements } from '../edgeless/model'

/**
 * The battle map's parts of the scene panel: its look and grid, its layers, light and sight,
 * the selected map items, and the generator.
 */

export function LookSection({ settings, onSettings }: { settings: SceneSettings; onSettings: (p: Partial<SceneSettings>) => void }) {
  const map = mapSettings(settings)
  const g = settings.grid
  return (
    <section className="sc-sec">
      <h3>Look</h3>
      <div className="sc-grid2">
        <label>
          Style
          <select className="sc-input" value={map.theme} onChange={(e) => onSettings({ map: { ...settings.map, theme: e.target.value as MapSettings['theme'] } })}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id} title={t.hint}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Grid
          <select className="sc-input" value={g.type ?? 'square'} onChange={(e) => onSettings({ grid: { ...g, type: e.target.value as 'square' | 'hex' | 'none' } })}>
            <option value="square">Squares</option>
            <option value="hex">Hexes</option>
            <option value="none">None (move freely)</option>
          </select>
        </label>
      </div>
      <p className="sc-hint">The style changes how floors, walls and props are drawn, never the shapes themselves.</p>
    </section>
  )
}

export function LayersSection({ settings, onSettings, elements, onSelect }: { settings: SceneSettings; onSettings: (p: Partial<SceneSettings>) => void; elements: Element[]; onSelect: (ids: string[]) => void }) {
  const map = mapSettings(settings)
  const { order, hidden, locked } = map.layers
  const set = (layers: Partial<MapSettings['layers']>) => onSettings({ map: { ...settings.map, layers: { ...map.layers, ...layers } } })
  const toggle = (list: MapLayer[], id: MapLayer) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const move = (id: MapLayer, by: number) => {
    const i = order.indexOf(id)
    const j = i + by
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ order: next })
  }
  const count = (id: MapLayer) => elements.filter((e) => layerOf(e) === id && e.type !== 'reveal').length
  // Shown top first, like a design tool.
  const rows = [...order].reverse()
  return (
    <section className="sc-sec">
      <h3>Layers</h3>
      <ul className="bm-layers">
        {rows.map((id) => {
          const def = LAYERS.find((l) => l.id === id)!
          const off = hidden.includes(id)
          const lock = locked.includes(id)
          return (
            <li key={id} className={off ? 'off' : ''}>
              <button className="sc-icon" aria-label={off ? `Show ${def.label}` : `Hide ${def.label}`} title={off ? 'Show' : 'Hide (players don’t get hidden layers either)'} onClick={() => set({ hidden: toggle(hidden, id) })}>
                {off ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button className="sc-icon" aria-label={lock ? `Unlock ${def.label}` : `Lock ${def.label}`} title={lock ? 'Unlock' : 'Lock: nothing on it can be picked or moved'} onClick={() => set({ locked: toggle(locked, id) })}>
                {lock ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
              <button className="bm-layer-name" title={def.hint} onClick={() => onSelect(elements.filter((e) => layerOf(e) === id && !lock && e.type !== 'reveal').map((e) => e.id))}>
                <span>{def.label}</span> <small>{count(id)}</small>
              </button>
              {id !== 'tokens' && (
                <>
                  <button className="sc-icon" aria-label={`Move ${def.label} up`} disabled={order.indexOf(id) >= order.length - 2} onClick={() => move(id, 1)}>
                    <ArrowUp size={12} />
                  </button>
                  <button className="sc-icon" aria-label={`Move ${def.label} down`} disabled={order.indexOf(id) === 0} onClick={() => move(id, -1)}>
                    <ArrowDown size={12} />
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <p className="sc-hint">Click a layer’s name to select everything on it. The GM layer is never sent to players.</p>
    </section>
  )
}

export function LightingSection({
  settings,
  onSettings,
  doc,
  playerView,
  onPlayerView,
  state,
}: {
  settings: SceneSettings
  onSettings: (p: Partial<SceneSettings>) => void
  doc: Y.Doc
  playerView: boolean
  onPlayerView: (on: boolean) => void
  state: MapState | null
}) {
  const l = lightingSettings(settings)
  const set = (patch: Partial<typeof l>) => onSettings({ lighting: { ...settings.lighting, ...patch } })
  return (
    <section className="sc-sec">
      <h3>Light & sight</h3>
      <div className="bm-seg wide" role="group" aria-label="Ambient light">
        {(['day', 'dusk', 'dark'] as const).map((a) => (
          <button key={a} className={l.ambient === a ? 'on' : ''} aria-pressed={l.ambient === a} onClick={() => set({ ambient: a })}>
            {a === 'day' ? 'Daylight' : a === 'dusk' ? 'Dusk' : 'Pitch black'}
          </button>
        ))}
      </div>
      <label className="sc-check" title="Walls and shut doors block what the characters see; players see only that">
        <input type="checkbox" checked={l.vision} onChange={(e) => set({ vision: e.target.checked })} /> line of sight for players
      </label>
      {l.vision && (
        <>
          <label className="sc-check" title="Where the party has been stays on their map, dimmed">
            <input type="checkbox" checked={l.explored} onChange={(e) => set({ explored: e.target.checked })} /> remember explored areas
          </label>
          <div className="sc-row">
            <button className={`sc-btn ${playerView ? 'on' : ''}`} onClick={() => onPlayerView(!playerView)} title="See the map as the party sees it">
              {playerView ? <EyeOff size={13} /> : <Eye size={13} />} See as players
            </button>
            <button className="sc-btn" onClick={() => (forget(doc), toast('The party’s map is unexplored again'))}>
              Forget explored
            </button>
          </div>
          {state && !state.vision?.visible.length && <p className="sc-hint">Put a player character token on the map: what it sees is what players see.</p>}
        </>
      )}
      <p className="sc-hint">
        Lights: the Light tool (L), props that glow (torches, braziers, campfires), or a token carrying one. {state ? `${state.lit.length} light${state.lit.length === 1 ? '' : 's'} on this map.` : ''}
      </p>
    </section>
  )
}

/** Settings of the selected rooms, walls, props and lights. */
export function MapItemsSection({ doc, items }: { doc: Y.Doc; items: Element[] }) {
  const areas = items.filter((e): e is AreaEl => e.type === 'area')
  const walls = items.filter((e): e is WallEl => e.type === 'wall')
  const props = items.filter((e): e is PropEl => e.type === 'prop')
  const lights = items.filter((e): e is LightEl => e.type === 'light')
  if (!areas.length && !walls.length && !props.length && !lights.length) return null
  const patch = (els: Element[], p: Record<string, unknown>) => updateElements(doc, Object.fromEntries(els.map((e) => [e.id, p])))
  const one = items.length === 1 ? items[0] : null
  return (
    <section className="sc-sec">
      <h3>{one ? itemName(one) : `${items.length} map items`}</h3>
      {areas.length > 0 && (
        <div className="sc-grid2">
          <label>
            Does
            <select className="sc-input" value={areas[0].op ?? 'add'} onChange={(e) => patch(areas, { op: e.target.value === 'carve' ? 'carve' : undefined })}>
              <option value="add">Adds</option>
              <option value="carve">Carves away</option>
            </select>
          </label>
          <label>
            Layer
            <select
              className="sc-input"
              value={layerOf(areas[0])}
              onChange={(e) => {
                const terrain = e.target.value === 'terrain'
                patch(areas, { layer: e.target.value, material: terrain ? 'grass' : 'stone' })
              }}
            >
              <option value="architecture">Architecture (floor)</option>
              <option value="terrain">Terrain (ground)</option>
            </select>
          </label>
          {(areas[0].op ?? 'add') === 'add' && (
            <label style={{ gridColumn: '1 / -1' }}>
              Material
              <select className="sc-input" value={areas[0].material ?? ''} onChange={(e) => patch(areas, { material: e.target.value })}>
                {Object.entries(layerOf(areas[0]) === 'terrain' ? TERRAIN : FLOORS).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {walls.length > 0 && (
        <div className="sc-row">
          <select className="sc-input" style={{ width: 'auto' }} value={walls[0].kind ?? 'wall'} onChange={(e) => patch(walls, { kind: e.target.value })}>
            {OPENINGS.map((o) => (
              <option key={o.kind} value={o.kind} title={o.hint}>
                {o.label}
              </option>
            ))}
          </select>
          {walls.some((w) => w.kind === 'door' || w.kind === 'secret') && (
            <button className={`sc-btn ${walls[0].open ? 'on' : ''}`} onClick={() => patch(walls, { open: !walls[0].open || undefined })} title="Players see through open doors (double-click a door to toggle)">
              {walls[0].open ? 'Open' : 'Shut'}
            </button>
          )}
        </div>
      )}
      {props.length > 0 && (
        <div className="sc-row">
          <select className="sc-input" style={{ width: 'auto' }} value={layerOf(props[0])} onChange={(e) => patch(props, { layer: e.target.value })} title="Which layer the prop is on">
            <option value="terrain">Terrain</option>
            <option value="architecture">Architecture</option>
            <option value="props">Props</option>
            <option value="gm">GM only (hidden trap, trigger)</option>
          </select>
          <button className={`sc-btn ${props[0].flip ? 'on' : ''}`} onClick={() => patch(props, { flip: !props[0].flip || undefined })} title="Mirror it">
            <FlipHorizontal2 size={13} />
          </button>
        </div>
      )}
      {one && (one.type === 'prop' || one.type === 'light') && <LightEditor doc={doc} el={one} />}
      <p className="sc-hint">{hintFor(items)}</p>
    </section>
  )
}

const itemName = (e: Element) =>
  e.type === 'area'
    ? e.op === 'carve'
      ? 'Carved space'
      : (layerOf(e) === 'terrain' ? TERRAIN[e.material ?? ''] : FLOORS[e.material ?? ''])?.label ?? 'Room'
    : e.type === 'wall'
      ? (OPENINGS.find((o) => o.kind === (e.kind ?? 'wall'))?.label ?? 'Wall')
      : e.type === 'prop'
        ? e.asset.startsWith('b:')
          ? (builtinById.get(e.asset.slice(2))?.label ?? 'Prop')
          : 'Your prop'
        : 'Light'

const hintFor = (items: Element[]) =>
  items.some((e) => e.type === 'wall' && e.kind && e.kind !== 'wall')
    ? 'Double-click a door to open or shut it. Delete removes the opening (the wall comes back).'
    : items.some((e) => e.type === 'area')
      ? 'Drag to move, handles to resize: walls follow. Ctrl+] and Ctrl+[ change which shape wins where they overlap.'
      : 'Drag to move, the round handle to turn it.'

/** A light: on a prop (its own, or none) or a light on its own. */
function LightEditor({ doc, el }: { doc: Y.Doc; el: PropEl | LightEl }) {
  const own = el.type === 'light' ? el.light : el.light
  const fromKind = el.type === 'prop' && el.asset.startsWith('b:') ? builtinById.get(el.asset.slice(2))?.light : undefined
  const l: Light | null = own ?? (fromKind ? LIGHT_PRESETS[fromKind]?.light ?? null : null)
  const set = (p: Partial<Light> | null) => updateElements(doc, { [el.id]: { light: p === null ? undefined : { ...(l ?? LIGHT_PRESETS.torch.light), ...p } } })
  if (!l)
    return (
      <div className="sc-row">
        <button className="sc-btn" onClick={() => set({})}>
          + Give it light
        </button>
      </div>
    )
  return (
    <div className="bm-light-edit">
      <div className="sc-grid2">
        <label>
          Bright (ft)
          <input className="sc-input" type="number" min={0} max={500} value={l.bright} onChange={(e) => set({ bright: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label>
          Dim (ft)
          <input className="sc-input" type="number" min={0} max={500} value={l.dim} onChange={(e) => set({ dim: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
      <div className="sc-row">
        <input type="color" value={l.color ?? '#ffd28a'} onChange={(e) => set({ color: e.target.value })} title="Colour" />
        <label className="sc-check">
          <input type="checkbox" checked={!!l.flicker} onChange={(e) => set({ flicker: e.target.checked || undefined })} /> flicker
        </label>
        <label className="sc-check">
          <input type="checkbox" checked={l.on !== false} onChange={(e) => set({ on: e.target.checked ? undefined : false })} /> lit
        </label>
        <label className="sc-check" title="A cone, like a bullseye lantern">
          <input type="checkbox" checked={!!l.cone} onChange={(e) => set({ cone: e.target.checked ? { dir: 0, angle: 60 } : undefined })} /> cone
        </label>
      </div>
      {l.cone && (
        <div className="sc-grid2">
          <label>
            Points (°)
            <input className="sc-input" type="number" value={l.cone.dir} onChange={(e) => set({ cone: { ...l.cone!, dir: Number(e.target.value) || 0 } })} />
          </label>
          <label>
            Width (°)
            <input className="sc-input" type="number" min={5} max={360} value={l.cone.angle} onChange={(e) => set({ cone: { ...l.cone!, angle: Math.max(5, Math.min(360, Number(e.target.value) || 60)) } })} />
          </label>
        </div>
      )}
      {el.type === 'prop' && (
        <button className="sc-btn" onClick={() => updateElements(doc, { [el.id]: { light: { ...l, on: false } } })} title="This prop gives no light">
          No light
        </button>
      )}
    </div>
  )
}

/** Make a map: a dungeon, a wilderness, a village, a town, a tavern, a camp or a ship. */
export function GenerateSection({ doc, settings, elements, viewCenter, onDone }: { doc: Y.Doc; settings: SceneSettings; elements: Element[]; viewCenter: () => [number, number]; onDone: (ids: string[]) => void }) {
  const [biome, setBiome] = useState<Biome>('dungeon')
  const [size, setSize] = useState<Size>('medium')
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1e6)))
  const drawn = elements.filter((e) => e.type === 'area' || e.type === 'wall' || e.type === 'prop' || e.type === 'light' || (e.type === 'text' && e.layer === 'gm' && e.group?.startsWith('gen')))
  const run = (replace: boolean) => {
    if (replace && drawn.length && !confirm(`Replace the ${drawn.length} drawn items on this map with a new ${BIOMES.find((b) => b.id === biome)?.label.toLowerCase()}?`)) return
    if (replace) deleteItems(doc, new Set(drawn.map((e) => e.id)))
    const [cx, cy] = viewCenter()
    const made = generate(biome, { size, seed: Number(seed) || 1, grid: settings.grid.size, cx, cy })
    const ids: string[] = []
    doc.transact(() => {
      for (const el of made) ids.push(addElement(doc, el))
    }, CANVAS)
    onDone(ids)
    setSeed(String(Math.floor(Math.random() * 1e6)))
    toast(`Made a ${BIOMES.find((b) => b.id === biome)?.label.toLowerCase()}: every room, wall and prop can be edited`)
  }
  return (
    <section className="sc-sec">
      <h3>
        <Wand2 size={13} /> Generate
      </h3>
      <div className="sc-grid2">
        <label>
          Map
          <select className="sc-input" value={biome} onChange={(e) => setBiome(e.target.value as Biome)}>
            {BIOMES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Size
          <select className="sc-input" value={size} onChange={(e) => setSize(e.target.value as Size)}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label style={{ gridColumn: '1 / -1' }} title="The same seed makes the same map">
          Seed
          <input className="sc-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 9))} />
        </label>
      </div>
      <div className="sc-row">
        <button className="sc-btn gold" onClick={() => run(true)}>
          {drawn.length ? 'Replace map' : 'Generate'}
        </button>
        {drawn.length > 0 && (
          <button className="sc-btn" onClick={() => run(false)} title="Add it in the middle of the view, keeping what's there">
            Add here
          </button>
        )}
      </div>
      <p className="sc-hint">{BIOMES.find((b) => b.id === biome)?.hint} What it makes is ordinary rooms, walls, doors and props: change anything afterwards.</p>
    </section>
  )
}
