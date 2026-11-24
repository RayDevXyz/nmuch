import { BookOpen, Compass, Flag, Globe, Map as MapIcon, Plus, Radio, ScrollText, Shield, Swords, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { setValue, createRow } from '../database/api'
import { RowProperties } from '../database/DatabaseView'
import { ALL_ROWS, useDatabase } from '../database/useDatabase'
import type { Row } from '../database/types'
import { uid } from '../lib/id'
import { openPage } from '../state/actions'
import { getState, setState, toast, useApp } from '../state/store'
import { createScene, listScenes, liveFor } from './live'
import { LiveSection, RulesSection, SubmissionsSection } from './TablePanel'
import { HubSection } from './HubSection'
import { addBeats, dndCampaign, dndWorkspace, TEMPLATES, type Campaign, type Workspace } from './api'
import { openCharacterWizard } from './CharacterWizard'
import { openCompendium } from './Compendium'
import { openAzgaarImport } from './AzgaarImport'

const STATUS: { id: string; label: string }[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'foreshadowed', label: 'Foreshadowed' },
  { id: 'happened', label: 'Happened' },
  { id: 'skipped', label: 'Skipped' },
]

/** Open a page as soon as the app knows it (pages made by the core arrive a moment later). */
export function openSoon(id: string, canvas = false, tries = 30) {
  if (getState().pages[id]) {
    if (canvas) setState((s) => ({ edgeless: { ...s.edgeless, [id]: true } }))
    openPage(id, 'replace')
  } else if (tries > 0) setTimeout(() => openSoon(id, canvas, tries - 1), 100)
}

/** A campaign's page: its details, the party, the story so far and what's next, sessions. */
export function CampaignOverview({ campaignId }: { campaignId: string }) {
  const [c, setC] = useState<Campaign | null>(null)
  const [w, setW] = useState<Workspace | null>(null)
  useEffect(() => {
    void dndCampaign(campaignId).then(setC, () => setC(null))
    void dndWorkspace().then(setW, () => setW(null))
  }, [campaignId])
  const parts = c?.parts
  return (
    <div className="cp">
      {w && <RowProperties rowId={campaignId} databaseId={w.campaigns} />}
      {parts && w && (
        <>
          <nav className="cp-links">
            <button className="cp-link map" onClick={() => openSoon(parts.map, true)}>
              <MapIcon size={16} /> World map
            </button>
            <button className="cp-link" onClick={() => openSoon(parts.npcs)}>
              <Users size={15} /> NPCs
            </button>
            <button className="cp-link" onClick={() => openSoon(parts.locations)}>
              <Compass size={15} /> Locations
            </button>
            <button className="cp-link" onClick={() => openSoon(parts.factions)}>
              <Flag size={15} /> Factions
            </button>
            <button className="cp-link" onClick={() => openSoon(parts.sessions)}>
              <ScrollText size={15} /> Sessions
            </button>
            <button className="cp-link" title="Bring in a world from Azgaar's Fantasy Map Generator" onClick={() => openAzgaarImport(campaignId)}>
              <Globe size={15} /> Import Azgaar world
            </button>
            <button className="cp-link" onClick={() => openCompendium()}>
              <BookOpen size={15} /> Compendium
            </button>
          </nav>
          <div className="cp-grid">
            <Party campaignId={campaignId} w={w} />
            <Story campaignId={campaignId} beatsDb={parts.beats} />
            <Sessions db={parts.sessions} />
            <BattleMaps campaignId={campaignId} />
            <PlayersTable campaignId={campaignId} title={c.title} />
          </div>
        </>
      )}
    </div>
  )
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="cp-panel">
      <header>
        <span className="cp-panel-title">
          {icon} {title}
        </span>
        {action}
      </header>
      <div className="fv-rule" />
      {children}
    </section>
  )
}

function Party({ campaignId, w }: { campaignId: string; w: Workspace }) {
  const { result } = useDatabase(w.characters, undefined, ALL_ROWS)
  const party = (result?.rows ?? []).filter((r) => Array.isArray(r.values[w.characterCampaign]) && (r.values[w.characterCampaign] as string[]).includes(campaignId))
  return (
    <Panel
      title="The party"
      icon={<Shield size={14} />}
      action={
        <button className="fv-btn" onClick={() => openCharacterWizard({ campaign: campaignId })}>
          <Plus size={12} /> Character
        </button>
      }
    >
      {party.length === 0 && <p className="cp-empty">No adventurers yet. Add one, or link a character to this campaign from its page.</p>}
      <div className="cp-party">
        {party.map((r) => {
          const hp = Number(r.values.hp ?? 0)
          const max = Math.max(1, Number(r.values.maxHp ?? 1))
          return (
            <button key={r.id} className="cp-hero" onClick={() => openSoon(r.id)}>
              <span className="cp-hero-name">{r.title || 'Unnamed hero'}</span>
              <span className="cp-hero-sub">{[r.values.race, r.values.class].filter(Boolean).join(' · ')}</span>
              <span className="cp-hero-bar">
                <i style={{ width: `${Math.max(0, Math.min(100, (hp / max) * 100))}%` }} />
              </span>
              <span className="cp-hero-stats">
                HP {hp}/{max} · AC {String(r.values.ac ?? '—')}
                {r.values.player ? ` · ${r.values.player}` : ''}
              </span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

function Story({ campaignId, beatsDb }: { campaignId: string; beatsDb: string }) {
  const { result } = useDatabase(beatsDb, undefined, ALL_ROWS)
  const [planning, setPlanning] = useState(false)
  const [template, setTemplate] = useState(TEMPLATES[0].id)
  const [arc, setArc] = useState('')
  const beats = result?.rows ?? []
  const arcs = useMemo(() => {
    const g = new Map<string, Row[]>()
    for (const b of beats) {
      const a = String(b.values.arc ?? '') || 'Loose threads'
      g.set(a, [...(g.get(a) ?? []), b])
    }
    for (const list of g.values()) list.sort((x, y) => Number(x.values.order ?? 0) - Number(y.values.order ?? 0))
    return [...g.entries()]
  }, [beats])
  const next = arcs.flatMap(([, l]) => l).find((b) => b.values.status === 'planned' || b.values.status === 'foreshadowed')
  const cycle = (b: Row) => {
    const i = STATUS.findIndex((s) => s.id === b.values.status)
    void setValue(b.id, 'status', STATUS[(i + 1) % STATUS.length].id)
  }
  const plan = async () => {
    await addBeats(campaignId, template, arc)
    setPlanning(false)
    setArc('')
    toast('Arc planned: tick beats off as they happen')
  }
  return (
    <Panel
      title="Story beats"
      icon={<ScrollText size={14} />}
      action={
        <button className="fv-btn" onClick={() => setPlanning((p) => !p)}>
          <Plus size={12} /> Plan an arc
        </button>
      }
    >
      {planning && (
        <div className="cp-plan">
          <div className="cp-templates">
            {TEMPLATES.map((t) => (
              <button key={t.id} className={`cp-template ${template === t.id ? 'on' : ''}`} onClick={() => setTemplate(t.id)}>
                <strong>{t.label}</strong>
                <span>{t.desc}</span>
              </button>
            ))}
          </div>
          <div className="cw-row">
            <input placeholder="Arc name (e.g. The Sunless Citadel)" value={arc} onChange={(e) => setArc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void plan()} />
            <button className="fv-btn gold" onClick={() => void plan()}>
              Add beats
            </button>
          </div>
        </div>
      )}
      {next && (
        <div className="cp-next">
          <span className="cp-next-label">◆ Current objective</span>
          <button className="cp-next-title" onClick={() => openSoon(next.id)}>
            {next.title}
          </button>
          {next.values.notes ? <span className="cp-next-notes">{String(next.values.notes)}</span> : null}
        </div>
      )}
      {arcs.length === 0 && !planning && <p className="cp-empty">No beats yet. Plan an arc from a template, or add beats in the Story beats database.</p>}
      {arcs.map(([name, list]) => {
        const done = list.filter((b) => b.values.status === 'happened' || b.values.status === 'skipped').length
        return (
          <div key={name} className="cp-arc">
            <div className="cp-arc-head">
              <span>{name}</span>
              <span className="cp-arc-count">
                {done}/{list.length}
              </span>
            </div>
            <ol className="cp-beats">
              {list.map((b) => (
                <li key={b.id} className={`st-${String(b.values.status ?? 'planned')}`}>
                  <button className="cp-beat-title" onClick={() => openSoon(b.id)}>
                    {b.title || 'Untitled beat'}
                  </button>
                  <button className="cp-status" title="Click: planned → foreshadowed → happened → skipped" onClick={() => cycle(b)}>
                    {STATUS.find((s) => s.id === b.values.status)?.label ?? 'Planned'}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )
      })}
    </Panel>
  )
}

function Sessions({ db }: { db: string }) {
  const { result } = useDatabase(db, undefined, ALL_ROWS)
  const rows = [...(result?.rows ?? [])].sort((a, b) => Number(b.values.number ?? 0) - Number(a.values.number ?? 0))
  const add = async () => {
    const n = rows.reduce((m, r) => Math.max(m, Number(r.values.number ?? 0)), 0) + 1
    const id = uid()
    await createRow(db, id, `Session ${n}`, { number: n, date: new Date().toISOString().slice(0, 10) })
    openSoon(id)
  }
  return (
    <Panel
      title="Sessions"
      icon={<BookOpen size={14} />}
      action={
        <button className="fv-btn" onClick={() => void add()}>
          <Plus size={12} /> Session
        </button>
      }
    >
      {rows.length === 0 && <p className="cp-empty">No sessions yet. Each session gets a page for your notes; link the beats that happened in it.</p>}
      <ul className="cp-sessions">
        {rows.slice(0, 8).map((r) => (
          <li key={r.id}>
            <button onClick={() => openSoon(r.id)}>
              <span className="cp-session-n">{String(r.values.number ?? '—')}</span>
              <span className="cp-session-title">{r.title}</span>
              <span className="cp-session-date">{r.values.date ? new Date(String(r.values.date) + 'T00:00:00').toLocaleDateString() : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** The campaign's battle maps: scenes the party plays on, live at the table. */
function BattleMaps({ campaignId }: { campaignId: string }) {
  const [ids, setIds] = useState<string[]>([])
  const pages = useApp((s) => s.pages)
  useEffect(() => {
    void listScenes(campaignId).then(setIds, () => setIds([]))
  }, [campaignId, pages])
  const scenes = ids.map((id) => pages[id]).filter((p): p is NonNullable<typeof p> => !!p && !p.trashedAt)
  const add = async () => {
    try {
      const id = await createScene(campaignId, `Battle map ${scenes.length + 1}`)
      openSoon(id, true)
    } catch (e) {
      toast(String(e))
    }
  }
  return (
    <Panel
      title="Battle maps"
      icon={<Swords size={14} />}
      action={
        <button className="fv-btn" onClick={() => void add()}>
          <Plus size={12} /> Battle map
        </button>
      }
    >
      {scenes.length === 0 && <p className="cp-empty">No battle maps yet. Make one, drop a dungeon picture on it, place tokens, and go live: your players join from their own screens.</p>}
      <ul className="cp-sessions">
        {scenes.map((p) => (
          <li key={p.id}>
            <button onClick={() => openSoon(p.id, true)}>
              <span className="cp-session-n">⚔</span>
              <span className="cp-session-title">{p.title || 'Untitled map'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** The campaign's table: one link for the players, the characters they submit, the rules. */
function PlayersTable({ campaignId, title }: { campaignId: string; title: string }) {
  const live = liveFor(campaignId)
  return (
    <Panel title="Players' table" icon={<Radio size={14} />}>
      <p className="cp-empty">Players join with one link for the whole campaign: their hub. They build characters there for you to approve, read their sheets, the journal you publish and the compendium, and see the battle map you show.</p>
      <div className="cp-table">
        <LiveSection live={live} title={title} />
        <SubmissionsSection live={live} campaignId={campaignId} />
        <HubSection campaignId={campaignId} />
        <RulesSection live={live} campaignId={campaignId} />
      </div>
    </Panel>
  )
}
