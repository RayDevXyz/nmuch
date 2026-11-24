import './battlemap.css'
import { Lightbulb } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import type * as Y from 'yjs'
import type { Element, ImageEl, LightEl, MapLayer, PropEl } from '../edgeless/model'
import type { SceneSettings } from '../dnd/live'
import { propSrc, useAssets, type Asset } from './assets'
import type { MapState } from './compute'
import { drawLight, drawSight, readExplored, remember } from './lighting'
import { layerOf } from './model'
import { lookOf, renderArchitecture, renderTerrain } from './render'

/**
 * The DM's view of a battle map's drawn layers, in their order: terrain (pictures, ground),
 * architecture (floors, walls, doors), props. Then the light over it. Everything carries
 * `data-cid`, so the canvas selects, moves and resizes it like any other element.
 */
export function MapLayers({
  idp,
  doc,
  elements,
  settings,
  state,
  selected,
  playerView,
}: {
  idp: string
  doc: Y.Doc
  elements: Element[]
  settings: SceneSettings
  state: MapState
  selected: Set<string>
  playerView: boolean
}) {
  const assets = useAssets(doc)
  const { map, hidden, locked, built, carves } = state
  const grid = settings.grid.size
  const look = lookOf(map.theme, grid)
  // The svg strings only change when the drawing does (not when a token moves).
  const selKey = [...selected].join(',')
  const terrain = useMemo(() => renderTerrain(built, { theme: map.theme, grid, idp, dm: !playerView, selected }), [built, map.theme, grid, idp, playerView, selKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const arch = useMemo(() => renderArchitecture(built, { theme: map.theme, grid, idp, dm: !playerView, selected }, carves), [built, carves, map.theme, grid, idp, playerView, selKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const b = state.bounds
  const svgBox = { left: b.x, top: b.y, width: b.w, height: b.h }
  const on = (layer: MapLayer) => elements.filter((e) => e.visible !== false && layerOf(e) === layer && (e.type === 'image' || e.type === 'prop' || e.type === 'light'))

  const layer = (id: MapLayer) => {
    if (hidden.has(id) || id === 'tokens') return null
    const lock = locked.has(id) ? ' bm-locked' : ''
    const items = on(id).map((e) => <Item key={e.id} el={e as ImageEl | PropEl | LightEl} assets={assets} selected={selected.has(e.id)} filter={look.propFilter} lock={lock} dm={!playerView} />)
    return (
      <div key={id} className={`bm-layer bm-layer-${id}${lock}`} data-layer={id}>
        {id === 'terrain' && (
          <>
            {/* The ground under everything drawn. */}
            {state.drawn && <div className="bm-ground" style={{ ...svgBox, background: look.ground }} />}
            {items.filter((_, i) => on(id)[i].type === 'image')}
            {terrain.body && <svg className="bm-svg" style={svgBox} viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} dangerouslySetInnerHTML={{ __html: `<defs>${terrain.defs}</defs>${terrain.body}` }} />}
            {items.filter((_, i) => on(id)[i].type !== 'image')}
          </>
        )}
        {id === 'architecture' && (
          <>
            {arch.body && <svg className="bm-svg" style={svgBox} viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} dangerouslySetInnerHTML={{ __html: `<defs>${arch.defs}</defs>${arch.body}` }} />}
            {items}
          </>
        )}
        {(id === 'props' || id === 'gm') && items}
      </div>
    )
  }
  return (
    <>
      {map.layers.order.map(layer)}
      <LightOverlay doc={doc} state={state} playerView={playerView} />
    </>
  )
}

function Item({ el, assets, selected, filter, lock, dm }: { el: ImageEl | PropEl | LightEl; assets: Record<string, Asset>; selected: boolean; filter: string; lock: string; dm: boolean }) {
  const [x, y, w, h] = el.xywh
  const gm = el.layer === 'gm' ? ' bm-gm' : ''
  if (el.type === 'light') {
    if (!dm) return null
    return (
      <div className={`bm-light-marker${selected ? ' selected' : ''}${lock}`} data-cid={el.id} style={{ left: x, top: y, width: w, height: h, ['--lc' as string]: el.light.color || '#ffd28a' }} title="A light (only you see this marker)">
        <Lightbulb size={Math.max(10, Math.min(w, h) * 0.6)} />
      </div>
    )
  }
  const style: React.CSSProperties = {
    left: x,
    top: y,
    width: w,
    height: h,
    opacity: el.opacity,
    transform: [el.rotate ? `rotate(${el.rotate}deg)` : '', el.type === 'prop' && el.flip ? 'scaleX(-1)' : ''].join(' ') || undefined,
  }
  const cls = `bm-item${selected ? ' selected' : ''}${lock}${gm}`
  if (el.type === 'image') return <img className={`cv-image ${cls}`} data-cid={el.id} src={el.src} alt="" draggable={false} style={style} />
  const src = propSrc(el.asset, assets)
  if (!src) return <div className={`${cls} bm-missing`} data-cid={el.id} style={style} title="This prop's picture is missing" />
  if (src.video)
    return <video className={`bm-prop ${cls}`} data-cid={el.id} src={src.src} autoPlay loop muted playsInline style={{ ...style, filter: filter || undefined, objectFit: 'fill' }} />
  return <img className={`bm-prop ${cls}`} data-cid={el.id} src={src.src} alt="" draggable={false} style={{ ...style, filter: filter || undefined }} />
}

/**
 * The light over the map, drawn on a canvas the size of the map. The DM sees through the dark
 * (dimmed); in "see as players" it's as dark as theirs, with their fog of sight.
 */
function LightOverlay({ doc, state, playerView }: { doc: Y.Doc; state: MapState; playerView: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { bounds: b, lit, lighting, vision } = state
  // Remember where the party has been.
  useEffect(() => {
    if (!vision || !lighting.explored) return
    const t = setTimeout(() => remember(doc, vision.visible), 400)
    return () => clearTimeout(t)
  }, [doc, vision, lighting.explored])
  const active = lit.length > 0 || lighting.ambient !== 'day' || (playerView && !!vision)
  useEffect(() => {
    const c = ref.current
    if (!c || !active) return
    const scale = Math.min(0.5, 4096 / Math.max(b.w, b.h))
    c.width = Math.max(1, Math.round(b.w * scale))
    c.height = Math.max(1, Math.round(b.h * scale))
    const ctx = c.getContext('2d')!
    let raf = 0
    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale)
      drawLight(ctx, b, lit, lighting.ambient, playerView ? 1 : 0.5, t)
      if (playerView && vision) drawSight(ctx, b, vision.visible, lighting.explored ? readExplored(doc) : [], 1)
      if (lit.some((l) => l.flicker)) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active, b.x, b.y, b.w, b.h, lit, lighting.ambient, lighting.explored, playerView, vision, doc])
  if (!active) return null
  return <canvas ref={ref} className="bm-light" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} aria-hidden />
}
