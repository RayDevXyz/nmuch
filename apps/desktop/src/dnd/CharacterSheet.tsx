import { ArrowUpCircle, Heart, Minus, Moon, Plus, Shield, Sparkles, Star, Sun, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { coreClient } from '../lib/storage'
import { useApp } from '../state/store'
import { getSheet, saveSheet } from './api'
import { openCompendium } from './Compendium'
import { ABILITIES, ABILITY_NAME, entries, find, levelLabel, mod, signed, type Ability, type Entry, type Ref } from './fivee'
import { Entries, OpenRef } from './render'
import {
  initiative,
  levelUp,
  normalize,
  passivePerception,
  profBonus,
  saveBonus,
  skillBonus,
  SKILLS,
  slots,
  spellAttack,
  spellDc,
  XP_FOR_LEVEL,
  type Sheet,
} from './rules'

const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious']

/** A character's sheet, shown at the top of the character's page; the page body is free notes. */
export function CharacterSheet({ pageId, editable = true }: { pageId: string; editable?: boolean }) {
  const name = useApp((s) => s.pages[pageId]?.title || 'Unnamed hero')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [tab, setTab] = useState<'features' | 'spells' | 'inventory'>('features')
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Load, and reload when the page changes elsewhere (another window, the table) while idle.
  useEffect(() => {
    let live = true
    const load = () => void getSheet(pageId).then((s) => live && !dirty.current && setSheet(normalize(s)))
    load()
    let t: ReturnType<typeof setTimeout> | undefined
    const off = coreClient().onEvent((e) => {
      if (e.type === 'pageChanged' && e.pageId === pageId && e.origin === 'local') {
        clearTimeout(t)
        t = setTimeout(load, 250)
      }
    })
    return () => {
      live = false
      off()
      clearTimeout(t)
    }
  }, [pageId])

  const update = (fn: (s: Sheet) => Sheet) =>
    setSheet((prev) => {
      if (!prev || !editable) return prev
      const next = fn(prev)
      dirty.current = true
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void saveSheet(pageId, next).finally(() => (dirty.current = false))
      }, 350)
      return next
    })
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!sheet) return <div className="cs-loading">Unrolling the character sheet…</div>
  const s = sheet
  const pb = profBonus(s.level)
  const nextXp = XP_FOR_LEVEL[Math.min(19, s.level)]
  const hpPct = Math.max(0, Math.min(100, (s.hp.current / Math.max(1, s.hp.max)) * 100))
  const tempPct = Math.min(100 - hpPct, (s.hp.temp / Math.max(1, s.hp.max)) * 100)

  return (
    <OpenRef.Provider value={(r) => openCompendium({ open: r })}>
      <div className="cs" data-testid="character-sheet">
        {/* ---- status cluster ---- */}
        <div className="cs-cluster">
          <div className="cs-tag">
            <span className="cs-tag-label">Level</span>
            <span className="cs-tag-level">{String(s.level).padStart(2, '0')}</span>
            <span className="cs-tag-label">{s.class ?? 'Adventurer'}</span>
            {editable && s.level < 20 && (
              <button className="cs-levelup" title="Level up: average hit points, more slots" onClick={() => update(levelUp)}>
                <ArrowUpCircle size={13} /> Level up
              </button>
            )}
          </div>
          <div className="cs-main">
            <div className="cs-name">{name}</div>
            <div className="cs-sub">
              {[s.race, s.class && `${s.class}${s.subclass ? ` (${s.subclass})` : ''}`, s.background, s.alignment].filter(Boolean).join(' · ') || 'Choose a race, class and background'}
              {s.player && <span className="cs-player"> — played by {s.player}</span>}
            </div>
            <Bar icon={<Heart size={13} />} kind="hp" pct={hpPct} extra={tempPct} label={`${s.hp.current}${s.hp.temp ? ` + ${s.hp.temp}` : ''} / ${s.hp.max}`} />
            <Bar icon={<Sparkles size={13} />} kind="xp" pct={Math.min(100, (s.xp / nextXp) * 100)} label={`XP ${s.xp.toLocaleString()} / ${nextXp.toLocaleString()}`} />
            <Bar icon={<Moon size={13} />} kind="dice" pct={((s.level - s.hitDiceUsed) / s.level) * 100} label={`Hit dice ${s.level - s.hitDiceUsed}d${s.hitDie} / ${s.level}`} />
            {editable && <HpControls sheet={s} update={update} />}
          </div>
          <div className="cs-side">
            <Stat label="Armor" value={s.ac} big icon={<Shield size={14} />} onChange={editable ? (v) => update((x) => ({ ...x, ac: v })) : undefined} />
            <Stat label="Initiative" value={signed(initiative(s))} />
            <Stat label="Speed" value={`${s.speed} ft`} />
            <Stat label="Proficiency" value={signed(pb)} />
            <Stat label="Passive Perc." value={passivePerception(s)} />
            <button className={`cs-inspiration ${s.inspiration ? 'on' : ''}`} title="Inspiration" onClick={() => update((x) => ({ ...x, inspiration: !x.inspiration }))}>
              <Star size={14} /> Inspiration
            </button>
          </div>
        </div>

        {/* ---- conditions ---- */}
        <div className="cs-conditions">
          {s.conditions.map((c) => (
            <span key={c} className="cs-condition">
              <a href="#" onClick={(e) => (e.preventDefault(), openCompendium({ open: { cat: 'condition', name: c, source: '' } }))}>
                {c}
              </a>
              {editable && (
                <button aria-label={`Remove ${c}`} onClick={() => update((x) => ({ ...x, conditions: x.conditions.filter((y) => y !== c) }))}>
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {editable && (
            <select
              className="cs-add-condition"
              value=""
              onChange={(e) => e.target.value && update((x) => ({ ...x, conditions: [...new Set([...x.conditions, e.target.value])] }))}
            >
              <option value="">+ Condition</option>
              {CONDITIONS.filter((c) => !s.conditions.includes(c)).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          {s.hp.current <= 0 && <DeathSaves sheet={s} update={update} />}
        </div>

        {/* ---- abilities ---- */}
        <div className="cs-abilities">
          {ABILITIES.map((a) => (
            <div key={a} className="cs-ability" title={ABILITY_NAME[a]}>
              <span className="cs-ab-name">{a.toUpperCase()}</span>
              <span className="cs-ab-mod">{signed(mod(s.abilities[a]))}</span>
              <input
                className="cs-ab-score"
                type="number"
                min={1}
                max={30}
                value={s.abilities[a]}
                disabled={!editable}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(30, Number(e.target.value) || 1))
                  update((x) => ({ ...x, abilities: { ...x.abilities, [a]: v } }))
                }}
              />
            </div>
          ))}
        </div>

        <div className="cs-columns">
          {/* ---- saves & skills: the parchment card ---- */}
          <div className="cs-parchment">
            <div className="cs-parch-title">✦ Saving Throws</div>
            <ul className="cs-checks">
              {ABILITIES.map((a) => (
                <li key={a}>
                  <Pip on={s.saves.includes(a)} onClick={editable ? () => update((x) => ({ ...x, saves: x.saves.includes(a) ? x.saves.filter((y) => y !== a) : [...x.saves, a] })) : undefined} />
                  <span>{ABILITY_NAME[a]}</span>
                  <b>{signed(saveBonus(s, a))}</b>
                </li>
              ))}
            </ul>
            <div className="cs-parch-title">✦ Skills</div>
            <ul className="cs-checks">
              {SKILLS.map(([k, label, a]) => (
                <li key={k}>
                  <Pip
                    on={!!s.skills[k]}
                    double={s.skills[k] === 2}
                    title="Click: proficient → expertise → none"
                    onClick={editable ? () => update((x) => ({ ...x, skills: cycle(x.skills, k) })) : undefined}
                  />
                  <span>
                    {label} <em>({a.toUpperCase()})</em>
                  </span>
                  <b>{signed(skillBonus(s, k, a))}</b>
                </li>
              ))}
            </ul>
          </div>

          {/* ---- tabs ---- */}
          <div className="cs-panel">
            <div className="cs-tabs" role="tablist">
              {(['features', 'spells', 'inventory'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'features' ? 'Features' : t === 'spells' ? 'Spells' : 'Inventory'}
                </button>
              ))}
            </div>
            {tab === 'features' && <Features sheet={s} />}
            {tab === 'spells' && <Spells sheet={s} update={update} editable={editable} />}
            {tab === 'inventory' && <Inventory sheet={s} update={update} editable={editable} />}
          </div>
        </div>
      </div>
    </OpenRef.Provider>
  )
}

function cycle(skills: Sheet['skills'], k: string): Sheet['skills'] {
  const next = { ...skills }
  if (!next[k]) next[k] = 1
  else if (next[k] === 1) next[k] = 2
  else delete next[k]
  return next
}

function Bar({ icon, kind, pct, extra = 0, label }: { icon: React.ReactNode; kind: string; pct: number; extra?: number; label: string }) {
  return (
    <div className={`cs-bar ${kind}`}>
      <span className="cs-bar-icon">{icon}</span>
      <div className="cs-bar-track">
        <i style={{ width: `${pct}%` }} />
        {extra > 0 && <i className="temp" style={{ left: `${pct}%`, width: `${extra}%` }} />}
      </div>
      <span className="cs-bar-label">{label}</span>
    </div>
  )
}

function Stat({ label, value, big, icon, onChange }: { label: string; value: string | number; big?: boolean; icon?: React.ReactNode; onChange?: (v: number) => void }) {
  return (
    <div className={`cs-stat ${big ? 'big' : ''}`}>
      <span className="cs-stat-label">
        {icon} {label}
      </span>
      {onChange ? (
        <input className="cs-stat-value" type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      ) : (
        <span className="cs-stat-value">{value}</span>
      )}
    </div>
  )
}

function Pip({ on, double, onClick, title }: { on: boolean; double?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button className={`cs-pip ${on ? 'on' : ''} ${double ? 'double' : ''}`} onClick={onClick} disabled={!onClick} title={title} aria-pressed={on}>
      ◆
    </button>
  )
}

function HpControls({ sheet: s, update }: { sheet: Sheet; update: (fn: (s: Sheet) => Sheet) => void }) {
  const [n, setN] = useState('')
  const amount = Math.max(0, Math.floor(Number(n) || 0))
  const damage = () =>
    update((x) => {
      const fromTemp = Math.min(x.hp.temp, amount)
      const current = Math.max(0, x.hp.current - (amount - fromTemp))
      return { ...x, hp: { ...x.hp, temp: x.hp.temp - fromTemp, current } }
    })
  const heal = () => update((x) => ({ ...x, hp: { ...x.hp, current: Math.min(x.hp.max, x.hp.current + amount) }, deathSaves: { success: 0, fail: 0 } }))
  const temp = () => update((x) => ({ ...x, hp: { ...x.hp, temp: Math.max(x.hp.temp, amount) } }))
  const longRest = () =>
    update((x) => ({
      ...x,
      hp: { ...x.hp, current: x.hp.max, temp: 0 },
      hitDiceUsed: Math.max(0, x.hitDiceUsed - Math.max(1, Math.floor(x.level / 2))),
      slotsUsed: [],
      deathSaves: { success: 0, fail: 0 },
      status: [...new Set([...x.status.filter((y) => y !== 'Weary'), 'Well rested'])],
    }))
  const shortRest = () => update((x) => ({ ...x, slotsUsed: x.casting?.progression === 'pact' ? [] : x.slotsUsed }))
  return (
    <div className="cs-hp">
      <input type="number" min={0} placeholder="0" value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (damage(), setN(''))} aria-label="Amount" />
      <button className="fv-btn" onClick={() => (damage(), setN(''))} disabled={!amount}>
        <Minus size={12} /> Damage
      </button>
      <button className="fv-btn" onClick={() => (heal(), setN(''))} disabled={!amount}>
        <Plus size={12} /> Heal
      </button>
      <button className="fv-btn ghost" onClick={() => (temp(), setN(''))} disabled={!amount} title="Temporary hit points">
        Temp
      </button>
      <span className="fv-grow" />
      <button className="fv-btn ghost" onClick={shortRest} title="Short rest (pact slots come back)">
        <Sun size={12} /> Short rest
      </button>
      <button className="fv-btn ghost" onClick={longRest} title="Long rest: full HP, slots, half your hit dice">
        <Moon size={12} /> Long rest
      </button>
      {s.status.length > 0 && <span className="cs-status">{s.status.join(' · ')}</span>}
    </div>
  )
}

function DeathSaves({ sheet: s, update }: { sheet: Sheet; update: (fn: (s: Sheet) => Sheet) => void }) {
  const set = (k: 'success' | 'fail', v: number) => update((x) => ({ ...x, deathSaves: { ...x.deathSaves, [k]: x.deathSaves[k] === v ? v - 1 : v } }))
  return (
    <span className="cs-death">
      Death saves
      {(['success', 'fail'] as const).map((k) => (
        <span key={k} className={`cs-death-row ${k}`}>
          {[1, 2, 3].map((i) => (
            <button key={i} className={s.deathSaves[k] >= i ? 'on' : ''} onClick={() => set(k, i)} aria-label={`${k} ${i}`} />
          ))}
        </span>
      ))}
    </span>
  )
}

// ---- tabs

function useEntryOf(ref: Ref | null) {
  const [e, setE] = useState<Entry | null>(null)
  const key = ref ? `${ref.cat}|${ref.name}|${ref.source}` : ''
  useEffect(() => {
    if (!ref) return setE(null)
    let live = true
    find(ref).then((x) => live && setE(x), () => live && setE(null))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return e
}

function Features({ sheet: s }: { sheet: Sheet }) {
  const cls = useEntryOf(s.class ? { cat: 'class', name: s.class, source: s.classSource ?? '' } : null)
  const race = useEntryOf(s.race ? { cat: 'race', name: s.race, source: s.raceSource ?? '' } : null)
  const bg = useEntryOf(s.background ? { cat: 'background', name: s.background, source: s.backgroundSource ?? '' } : null)
  const features = ((cls?.raw.features ?? []) as { level: number; name: string; entries: unknown }[]).filter((f) => f.level <= s.level).sort((a, b) => a.level - b.level)
  if (!s.class && !s.race && !s.background) return <p className="cs-empty">Features appear here once the character has a race, class and background from your 5etools.</p>
  return (
    <div className="cs-features">
      {features.length > 0 && <h4 className="cs-h">{s.class} features</h4>}
      {features.map((f, i) => (
        <details key={i} className="cs-feature" open={f.level === s.level}>
          <summary>
            <span className="fv-level">{f.level}</span> {f.name}
          </summary>
          <Entries entries={f.entries} depth={1} />
        </details>
      ))}
      {race && (
        <>
          <h4 className="cs-h">{race.name} traits</h4>
          <div className="cs-feature-body">
            <Entries entries={race.raw.entries} depth={1} />
          </div>
        </>
      )}
      {bg && (
        <>
          <h4 className="cs-h">{bg.name}</h4>
          <div className="cs-feature-body">
            <Entries entries={bg.raw.entries} depth={1} />
          </div>
        </>
      )}
    </div>
  )
}

function Spells({ sheet: s, update, editable }: { sheet: Sheet; update: (fn: (s: Sheet) => Sheet) => void; editable: boolean }) {
  const { counts, pactLevel } = slots(s.casting?.progression, s.level)
  const [levels, setLevels] = useState<Record<string, number>>({})
  useEffect(() => {
    void entries('spell').then(
      (all) => setLevels(Object.fromEntries(all.map((e) => [`${e.name}|${e.source}`, Number(e.raw.level ?? 0)]))),
      () => {},
    )
  }, [])
  const byLevel = useMemo(() => {
    const g = new Map<number, Sheet['spells']>()
    for (const sp of s.spells) {
      const l = levels[`${sp.name}|${sp.source}`] ?? 0
      g.set(l, [...(g.get(l) ?? []), sp])
    }
    return [...g.entries()].sort((a, b) => a[0] - b[0])
  }, [s.spells, levels])
  const useSlot = (lvl: number, i: number) =>
    update((x) => {
      const used = [...x.slotsUsed]
      used[lvl] = (used[lvl] ?? 0) > i ? i : i + 1
      return { ...x, slotsUsed: used }
    })
  return (
    <div className="cs-spells">
      {s.casting ? (
        <div className="cs-casting">
          <span>Casting: {ABILITY_NAME[s.casting.ability]}</span>
          <span>Save DC {spellDc(s)}</span>
          <span>Attack {signed(spellAttack(s) ?? 0)}</span>
          {pactLevel && <span>Pact slots: {levelLabel(pactLevel)}</span>}
        </div>
      ) : (
        <p className="cs-empty">This class doesn't cast spells (you can still list spells from items or feats).</p>
      )}
      {counts.some((n) => n > 0) && (
        <div className="cs-slots">
          {counts.map((n, lvl) =>
            n > 0 ? (
              <div key={lvl} className="cs-slot-row">
                <span>{levelLabel(lvl + 1)}</span>
                {Array.from({ length: n }, (_, i) => (
                  <button key={i} className={`cs-slot ${(s.slotsUsed[lvl] ?? 0) > i ? 'used' : ''}`} onClick={() => editable && useSlot(lvl, i)} aria-label={`Slot ${lvl + 1}.${i + 1}`} />
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}
      {byLevel.map(([lvl, list]) => (
        <div key={lvl}>
          <h4 className="cs-h">{lvl === 0 ? 'Cantrips' : levelLabel(lvl)}</h4>
          <ul className="cs-list">
            {list.map((sp) => (
              <li key={`${sp.name}|${sp.source}`}>
                {lvl > 0 && (
                  <Pip
                    on={!!sp.prepared}
                    title="Prepared"
                    onClick={editable ? () => update((x) => ({ ...x, spells: x.spells.map((y) => (y === sp ? { ...y, prepared: !y.prepared } : y)) })) : undefined}
                  />
                )}
                <a href="#" onClick={(e) => (e.preventDefault(), openCompendium({ open: { cat: 'spell', name: sp.name, source: sp.source } }))}>
                  {sp.name}
                </a>
                {editable && (
                  <button className="fv-icon" aria-label={`Remove ${sp.name}`} onClick={() => update((x) => ({ ...x, spells: x.spells.filter((y) => y !== sp) }))}>
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {editable && (
        <button
          className="fv-btn"
          onClick={() =>
            openCompendium({
              cats: ['spell'],
              title: 'Add a spell',
              onPick: (r) => update((x) => (x.spells.some((y) => y.name === r.name && y.source === r.source) ? x : { ...x, spells: [...x.spells, { name: r.name, source: r.source }] })),
            })
          }
        >
          <Plus size={13} /> Add spell
        </button>
      )}
    </div>
  )
}

function Inventory({ sheet: s, update, editable }: { sheet: Sheet; update: (fn: (s: Sheet) => Sheet) => void; editable: boolean }) {
  const [custom, setCustom] = useState('')
  const setItem = (i: number, patch: Partial<Sheet['inventory'][number]>) =>
    update((x) => ({ ...x, inventory: x.inventory.map((it, j) => (j === i ? { ...it, ...patch } : it)).filter((it) => it.qty > 0) }))
  return (
    <div className="cs-inventory">
      <ul className="cs-list">
        {s.inventory.map((it, i) => (
          <li key={`${it.name}|${i}`}>
            <Pip on={!!it.equipped} title="Equipped" onClick={editable ? () => setItem(i, { equipped: !it.equipped }) : undefined} />
            {it.source ? (
              <a href="#" onClick={(e) => (e.preventDefault(), openCompendium({ open: { cat: 'item', name: it.name, source: it.source! } }))}>
                {it.name}
              </a>
            ) : (
              <span>{it.name}</span>
            )}
            <span className="cs-qty">
              {editable && (
                <button className="fv-icon" aria-label="One less" onClick={() => setItem(i, { qty: it.qty - 1 })}>
                  <Minus size={11} />
                </button>
              )}
              ×{it.qty}
              {editable && (
                <button className="fv-icon" aria-label="One more" onClick={() => setItem(i, { qty: it.qty + 1 })}>
                  <Plus size={11} />
                </button>
              )}
            </span>
          </li>
        ))}
        {s.inventory.length === 0 && <li className="cs-empty">An empty pack.</li>}
      </ul>
      {editable && (
        <div className="cs-add-row">
          <button className="fv-btn" onClick={() => openCompendium({ cats: ['item'], title: 'Add an item', onPick: (r) => update((x) => ({ ...x, inventory: [...x.inventory, { name: r.name, source: r.source, qty: 1 }] })) })}>
            <Plus size={13} /> From compendium
          </button>
          <input
            placeholder="Or type an item…"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) {
                update((x) => ({ ...x, inventory: [...x.inventory, { name: custom.trim(), qty: 1 }] }))
                setCustom('')
              }
            }}
          />
        </div>
      )}
      <div className="cs-currency">
        {(['pp', 'gp', 'ep', 'sp', 'cp'] as const).map((c) => (
          <label key={c} className={`cs-coin ${c}`}>
            <span>{c.toUpperCase()}</span>
            <input
              type="number"
              min={0}
              value={s.currency[c]}
              disabled={!editable}
              onChange={(e) => update((x) => ({ ...x, currency: { ...x.currency, [c]: Math.max(0, Number(e.target.value) || 0) } }))}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

export type { Ability }
