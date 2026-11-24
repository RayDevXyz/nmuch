import { ResizeHandle } from './ResizeHandle'
import { useCanvasAssets } from '../edgeless/bridge'
import { AssetsPanel } from '../edgeless/SidePanel'
import { ScenePanel } from '../edgeless/scene'
import { GROUPS } from './HelpModal'
import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { AtSign, Link2, X } from 'lucide-react'
import { openPage } from '../state/actions'
import { setState, useApp } from '../state/store'
import { db } from '../lib/storage'
import type { Link, Page, Ref } from '../lib/types'
import { IconButton } from './TopBar'

interface GNode extends SimulationNodeDatum {
  id: string
  title: string
  deg: number
}
type GLink = SimulationLinkDatum<GNode> & { kind: 'link' | 'child' }

function useLinks() {
  const version = useApp((s) => s.indexVersion)
  const [links, setLinks] = useState<Link[]>([])
  useEffect(() => {
    const t = setTimeout(() => db().links().then(setLinks), 250)
    return () => clearTimeout(t)
  }, [version])
  return links
}

function GraphView({ links, mode }: { links: Link[]; mode: 'local' | 'all' }) {
  const pages = useApp((s) => s.pages)
  const activeId = useApp((s) => s.activeId)
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const [hover, setHover] = useState<string | null>(null)

  const graph = useMemo(() => {
    const live = (id: string) => pages[id] && pages[id].trashedAt == null
    const edges: { s: string; t: string; kind: 'link' | 'child' }[] = []
    const seen = new Set<string>()
    links.forEach((l) => {
      if (l.source === l.target || !live(l.source) || !live(l.target)) return
      const k = [l.source, l.target].sort().join('|')
      if (seen.has(k)) return
      seen.add(k)
      edges.push({ s: l.source, t: l.target, kind: 'link' })
    })
    Object.values(pages).forEach((p) => {
      if (p.parentId && !p.databaseId && live(p.id) && live(p.parentId)) {
        const k = [p.id, p.parentId].sort().join('|')
        if (!seen.has(k)) {
          seen.add(k)
          edges.push({ s: p.parentId, t: p.id, kind: 'child' })
        }
      }
    })
    let ids: Set<string>
    if (mode === 'local' && activeId && live(activeId)) {
      ids = new Set([activeId])
      for (let depth = 0; depth < 2; depth++) {
        const add: string[] = []
        edges.forEach((e) => {
          if (ids.has(e.s) && !ids.has(e.t)) add.push(e.t)
          if (ids.has(e.t) && !ids.has(e.s)) add.push(e.s)
        })
        add.forEach((a) => ids.add(a))
      }
    } else {
      ids = new Set(Object.values(pages).filter((p) => p.trashedAt == null && !p.databaseId).map((p) => p.id))
    }
    const deg = new Map<string, number>()
    const es = edges.filter((e) => ids.has(e.s) && ids.has(e.t))
    es.forEach((e) => {
      deg.set(e.s, (deg.get(e.s) ?? 0) + 1)
      deg.set(e.t, (deg.get(e.t) ?? 0) + 1)
    })
    const nodes: GNode[] = [...ids].map((id) => {
      const prev = positions.current.get(id)
      return { id, title: pages[id]?.title || 'Untitled', deg: deg.get(id) ?? 0, x: prev?.x, y: prev?.y }
    })
    const glinks: GLink[] = es.map((e) => ({ source: e.s, target: e.t, kind: e.kind }))
    const sim = forceSimulation(nodes)
      .force('link', forceLink<GNode, GLink>(glinks).id((d) => d.id).distance((l) => (l.kind === 'child' ? 38 : 58)))
      .force('charge', forceManyBody().strength(-150))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<GNode>((d) => 10 + Math.sqrt(d.deg) * 3))
      .stop()
    sim.tick(nodes.some((n) => n.x == null) ? 260 : 120)
    nodes.forEach((n) => positions.current.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }))
    const xs = nodes.map((n) => n.x ?? 0)
    const ys = nodes.map((n) => n.y ?? 0)
    const pad = 34
    const minX = Math.min(...xs, -60) - pad
    const maxX = Math.max(...xs, 60) + pad
    const minY = Math.min(...ys, -60) - pad
    const maxY = Math.max(...ys, 60) + pad
    return { nodes, links: glinks, box: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, scale: Math.max(1, (maxX - minX) / 280) }
  }, [links, pages, activeId, mode])

  const neighbours = useMemo(() => {
    const m = new Set<string>()
    if (!hover) return m
    graph.links.forEach((l) => {
      const s = (l.source as GNode).id
      const t = (l.target as GNode).id
      if (s === hover) m.add(t)
      if (t === hover) m.add(s)
    })
    return m
  }, [hover, graph])

  const showLabel = (n: GNode) => n.id === activeId || n.id === hover || neighbours.has(n.id) || graph.nodes.length <= 14 || n.deg >= 3
  const k = graph.scale

  return (
    <div className="graph-wrap">
      {graph.nodes.length ? (
        <svg viewBox={graph.box} role="img" aria-label="Connected notes graph">
          <g className="graph-lines">
            {graph.links.map((l, i) => {
              const s = l.source as GNode
              const t = l.target as GNode
              const hot = hover && (s.id === hover || t.id === hover)
              return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} className={`${l.kind} ${hot ? 'hot' : ''}`} strokeWidth={k} />
            })}
          </g>
          <g className="graph-nodes">
            {graph.nodes.map((n) => {
              const r = (n.id === activeId ? 11 : 4.5 + Math.sqrt(n.deg) * 2.4) * Math.min(k, 1.6)
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={(e) => openPage(n.id, e.ctrlKey || e.metaKey ? 'tab' : 'replace')} className="graph-node">
                  <circle r={r} className={`${n.id === activeId ? 'node-main' : ''} ${hover === n.id ? 'hot' : ''} ${pages[n.id]?.archived ? 'archived' : ''}`} strokeWidth={2 * k} />
                  {showLabel(n) && (
                    <text y={r + 10 * k} textAnchor="middle" className="graph-labels" style={{ fontSize: 8 * k }}>
                      {n.title.length > 22 ? n.title.slice(0, 21) + '…' : n.title}
                    </text>
                  )}
                  <title>{n.title}</title>
                </g>
              )
            })}
          </g>
        </svg>
      ) : (
        <div className="graph-empty">No pages yet</div>
      )}
    </div>
  )
}

function RefList({ refs, pages, icon }: { refs: Ref[]; pages: Record<string, Page>; icon: React.ReactNode }) {
  const groups = useMemo(() => {
    const m = new Map<string, Ref[]>()
    refs.forEach((r) => {
      if (!pages[r.pageId] || pages[r.pageId].trashedAt != null) return
      if (!m.has(r.pageId)) m.set(r.pageId, [])
      m.get(r.pageId)!.push(r)
    })
    return [...m.entries()]
  }, [refs, pages])
  if (!groups.length) return <div className="panel-empty">None yet</div>
  return (
    <>
      {groups.map(([pid, rs]) => (
        <div className="ref-group" key={pid}>
          <button className={`backlink-row ${pages[pid].archived ? 'archived' : ''}`} title={pages[pid].archived ? 'Archived' : undefined} onClick={(e) => openPage(pid, e.ctrlKey || e.metaKey ? 'tab' : 'replace')}>
            {icon}
            <span>{pages[pid].icon ? pages[pid].icon + ' ' : ''}{pages[pid].title || 'Untitled'}</span>
          </button>
          {rs.slice(0, 3).map((r) => (
            <button key={r.blockId} className="ref-snippet" onClick={() => openPage(pid, 'replace', r.blockId)}>
              {r.text.length > 140 ? r.text.slice(0, 139) + '…' : r.text || '—'}
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

export function RightPanel() {
  const activeId = useApp((s) => s.activeId)
  const pages = useApp((s) => s.pages)
  const version = useApp((s) => s.indexVersion)
  const title = activeId ? pages[activeId]?.title ?? '' : ''
  const links = useLinks()
  const [mode, setMode] = useState<'local' | 'all'>('local')
  const [back, setBack] = useState<Ref[]>([])
  const [mentions, setMentions] = useState<Ref[]>([])

  useEffect(() => {
    if (!activeId) {
      setBack([])
      setMentions([])
      return
    }
    const t = setTimeout(() => {
      db().backlinks(activeId).then(setBack)
      db().mentions(activeId, title).then(setMentions)
    }, 250)
    return () => clearTimeout(t)
  }, [activeId, version, title])

  const backCount = new Set(back.filter((b) => pages[b.pageId]?.trashedAt == null).map((b) => b.pageId)).size
  const menCount = new Set(mentions.filter((b) => pages[b.pageId]?.trashedAt == null).map((b) => b.pageId)).size

  const width = useApp((s) => s.rightWidth)
  const rightView = useApp((s) => s.rightView)
  const canvas = useCanvasAssets()
  const onCanvas = !!canvas && canvas.pageId === activeId
  const scenePanel = onCanvas ? canvas.scenePanel : null
  const assets = onCanvas && (rightView === 'assets' || (!scenePanel && (rightView === 'map' || rightView === 'table')))
  const sceneTab = scenePanel && (rightView === 'map' || rightView === 'table') ? rightView : null
  const handle = <ResizeHandle edge="left" width={width} min={240} max={620} initial={290} onWidth={(w) => setState({ rightWidth: w })} label="Right panel width" />
  // While a canvas is open, this panel can show its assets instead (and switch back).
  const viewSwitch = canvas && canvas.pageId === activeId && (
    <div className="seg small rp-view" role="tablist" aria-label="Right panel">
      <button role="tab" aria-selected={assets} className={assets ? 'on' : ''} onClick={() => setState({ rightView: 'assets' })}>
        Assets
      </button>
      {scenePanel && (
        <>
          <button role="tab" aria-selected={sceneTab === 'map'} className={sceneTab === 'map' ? 'on' : ''} onClick={() => setState({ rightView: 'map' })}>
            Map
          </button>
          <button role="tab" aria-selected={sceneTab === 'table'} className={sceneTab === 'table' ? 'on' : ''} onClick={() => setState({ rightView: 'table' })}>
            Table
          </button>
        </>
      )}
      <button role="tab" aria-selected={!assets && !sceneTab} className={!assets && !sceneTab ? 'on' : ''} onClick={() => setState({ rightView: 'graph' })}>
        Graph
      </button>
    </div>
  )

  if (sceneTab && scenePanel)
    return (
      <aside className="right-panel rp-assets" style={{ width }}>
        {handle}
        <div className="right-heading">
          <span>{sceneTab === 'map' ? 'Map' : 'Table'}</span>
          <div className="right-heading-actions">
            {viewSwitch}
            <IconButton label="Hide the panel" onClick={() => setState({ rightOpen: false })}>
              <X />
            </IconButton>
          </div>
        </div>
        <div className="rp-scene-body">
          <ScenePanel {...scenePanel} tab={sceneTab} />
        </div>
      </aside>
    )

  if (assets && canvas)
    return (
      <aside className="right-panel rp-assets" style={{ width }}>
        {handle}
        <div className="right-heading">
          <span>Canvas</span>
          <div className="right-heading-actions">
            {viewSwitch}
            <IconButton label="Hide the panel" onClick={() => setState({ rightOpen: false })}>
              <X />
            </IconButton>
          </div>
        </div>
        <AssetsPanel {...canvas} />
      </aside>
    )

  return (
    <aside className="right-panel" style={{ width }}>
      {handle}
      {viewSwitch && <div className="right-heading rp-switch-row">{viewSwitch}</div>}
      <div className="right-heading">
        <span>Graph View</span>
        <div className="right-heading-actions">
          <div className="seg small">
            <button className={mode === 'local' ? 'on' : ''} onClick={() => setMode('local')}>
              Local
            </button>
            <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
              All
            </button>
          </div>
        </div>
      </div>
      <GraphView links={links} mode={mode} />
      <div className="backlinks">
        <div className="right-subheading">
          <span>Backlinks</span>
          <span className="count">{backCount}</span>
        </div>
        {activeId ? <RefList refs={back} pages={pages} icon={<Link2 size={13} />} /> : <div className="panel-empty">Open a page</div>}
      </div>
      <div className="backlinks mentions">
        <div className="right-subheading">
          <span>Unlinked mentions</span>
          <span className="count">{menCount}</span>
        </div>
        {activeId ? <RefList refs={mentions} pages={pages} icon={<AtSign size={13} />} /> : null}
      </div>
      <Shortcuts />
    </aside>
  )
}

const SHORTCUT_GROUP = 'bw.rightShortcuts'

/** Keyboard shortcuts, one group at a time, at the bottom of the right panel. */
function Shortcuts() {
  const [group, setGroup] = useState(() => {
    try {
      return localStorage.getItem(SHORTCUT_GROUP) ?? GROUPS[0][0]
    } catch {
      return GROUPS[0][0]
    }
  })
  const pick = (g: string) => {
    setGroup(g)
    try {
      localStorage.setItem(SHORTCUT_GROUP, g)
    } catch {
      /* not remembered */
    }
  }
  const items = (GROUPS.find(([g]) => g === group) ?? GROUPS[0])[1]
  return (
    <div className="backlinks rp-shortcuts">
      <div className="right-subheading">
        <span>Shortcuts</span>
        <select aria-label="Shortcut group" value={group} onChange={(e) => pick(e.target.value)}>
          {GROUPS.map(([g]) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      <dl>
        {items.map(([k, d]) => (
          <div key={k + d}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
      <button className="rp-shortcuts-all" onClick={() => setState({ help: true })}>
        All shortcuts <kbd>Ctrl /</kbd>
      </button>
    </div>
  )
}
