import { Dices, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { openPage } from '../state/actions'
import { getState, toast } from '../state/store'
import { createCharacter, refreshRoles } from './api'
import { ABILITIES, ABILITY_NAME, entries, mod, signed, type Ability, type Entry, type Raw } from './fivee'
import { asi } from './Statblock'
import { backgroundSkills, buildSheet, classSkillChoice, POINT_COST, racialBonuses, SKILLS, STANDARD_ARRAY } from './rules'

/** "New character": a short guided form, then the sheet does the rest. */

let request: { campaign?: string | null } | null = null
const listeners = new Set<() => void>()
const set = (r: typeof request) => {
  request = r
  listeners.forEach((l) => l())
}
export const openCharacterWizard = (opts: { campaign?: string | null } = {}) => set(opts)

export function CharacterWizardHost() {
  const r = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => request)
  return r ? <Wizard campaign={r.campaign ?? null} close={() => set(null)} /> : null
}

type Method = 'standard' | 'pointbuy' | 'manual'

function useList(cat: 'race' | 'class' | 'background') {
  const [list, setList] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    entries(cat).then(setList, (e) => (setError(String(e).replace(/^Error:\s*/, '')), setList([])))
  }, [cat])
  return { list, error }
}

function Wizard({ campaign, close }: { campaign: string | null; close: () => void }) {
  const races = useList('race')
  const classes = useList('class')
  const backgrounds = useList('background')
  const [name, setName] = useState('')
  const [player, setPlayer] = useState('')
  const [race, setRace] = useState<Entry | null>(null)
  const [cls, setCls] = useState<Entry | null>(null)
  const [bg, setBg] = useState<Entry | null>(null)
  const [method, setMethod] = useState<Method>('standard')
  const [base, setBase] = useState<Record<Ability, number>>({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })
  const [skills, setSkills] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const offline = !!(races.error && classes.error)

  const bonus = racialBonuses(race?.raw ?? null)
  const choice = classSkillChoice(cls?.raw ?? null)
  const fromBg = backgroundSkills(bg?.raw ?? null)
  const spent = ABILITIES.reduce((n, a) => n + (POINT_COST[base[a]] ?? 99), 0)
  const arrayOk = method !== 'standard' || [...ABILITIES.map((a) => base[a])].sort().join() === [...STANDARD_ARRAY].sort().join()
  const pointsOk = method !== 'pointbuy' || spent <= 27

  // Point buy starts everyone at 8; the standard array at its usual spread.
  const pickMethod = (m: Method) => {
    setMethod(m)
    if (m === 'pointbuy') setBase({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })
    if (m === 'standard') setBase({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })
  }

  const create = async () => {
    setBusy(true)
    try {
      const sheet = buildSheet({ player, race: race?.raw ?? null, cls: cls?.raw ?? null, background: bg?.raw ?? null, base, skills })
      const id = await createCharacter(name.trim() || 'Unnamed hero', sheet, campaign)
      await refreshRoles()
      close()
      toast(`${name.trim() || 'Your hero'} is ready`)
      // The new page reaches the app's page list a moment later.
      const open = (tries = 30) => (openWhenReady(id) ? undefined : tries > 0 && setTimeout(() => open(tries - 1), 100))
      open()
    } catch (e) {
      toast(`Could not create the character: ${String(e).replace(/^Error:\s*/, '')}`)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="fv-compendium cw dnd-theme" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="New character">
        <header className="fv-comp-head">
          <Sparkles size={18} />
          <span className="fv-comp-title">A new adventurer</span>
          <button className="fv-icon" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="cw-body">
          {offline && <div className="fv-error">Your 5etools isn't reachable ({races.error}). You can still create the character and fill in the sheet by hand.</div>}
          <section className="cw-step">
            <h3>I · Name</h3>
            <div className="cw-row">
              <input autoFocus placeholder="Character name" value={name} onChange={(e) => setName(e.target.value)} />
              <input placeholder="Player" value={player} onChange={(e) => setPlayer(e.target.value)} />
            </div>
          </section>
          <section className="cw-step">
            <h3>II · Race</h3>
            <Choice list={races.list} value={race} onChange={setRace} detail={(r) => [asi(r.ability ?? []), r.speed ? `speed ${typeof r.speed === 'number' ? r.speed : r.speed.walk} ft.` : '', r.darkvision ? `darkvision ${r.darkvision} ft.` : ''].filter(Boolean).join(' · ')} />
          </section>
          <section className="cw-step">
            <h3>III · Class</h3>
            <Choice
              list={classes.list}
              value={cls}
              onChange={(c) => (setCls(c), setSkills([]))}
              detail={(c) => [c.hd ? `d${c.hd.faces} hit die` : '', c.proficiency ? `saves ${c.proficiency.map((a: string) => a.toUpperCase()).join(', ')}` : '', c.spellcastingAbility ? `casts with ${c.spellcastingAbility.toUpperCase()}` : ''].filter(Boolean).join(' · ')}
            />
          </section>
          <section className="cw-step">
            <h3>IV · Background</h3>
            <Choice list={backgrounds.list} value={bg} onChange={setBg} detail={(b) => (backgroundSkills(b).length ? `skills: ${backgroundSkills(b).join(', ')}` : '')} />
          </section>
          <section className="cw-step">
            <h3>V · Ability scores</h3>
            <div className="cw-methods">
              {(
                [
                  ['standard', 'Standard array'],
                  ['pointbuy', 'Point buy'],
                  ['manual', 'Rolled / manual'],
                ] as const
              ).map(([m, label]) => (
                <button key={m} className={`fv-chip ${method === m ? 'on' : ''}`} onClick={() => pickMethod(m)}>
                  {m === 'manual' && <Dices size={11} />} {label}
                </button>
              ))}
              {method === 'pointbuy' && <span className={`cw-points ${pointsOk ? '' : 'over'}`}>{27 - spent} points left</span>}
              {method === 'standard' && !arrayOk && <span className="cw-points over">Use each of 15, 14, 13, 12, 10, 8 once</span>}
            </div>
            <div className="cw-abilities">
              {ABILITIES.map((a) => {
                const total = base[a] + (bonus[a] ?? 0)
                return (
                  <label key={a} className="cs-ability" title={ABILITY_NAME[a]}>
                    <span className="cs-ab-name">{a.toUpperCase()}</span>
                    {method === 'standard' ? (
                      <select value={base[a]} onChange={(e) => setBase({ ...base, [a]: Number(e.target.value) })}>
                        {STANDARD_ARRAY.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        min={method === 'pointbuy' ? 8 : 3}
                        max={method === 'pointbuy' ? 15 : 20}
                        value={base[a]}
                        onChange={(e) => setBase({ ...base, [a]: Math.max(method === 'pointbuy' ? 8 : 1, Math.min(method === 'pointbuy' ? 15 : 30, Number(e.target.value) || 8)) })}
                      />
                    )}
                    <span className="cw-total">
                      {total}
                      {bonus[a] ? <em> ({signed(bonus[a]!)})</em> : null} · {signed(mod(total))}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
          {choice.count > 0 && (
            <section className="cw-step">
              <h3>
                VI · Skills <small>choose {choice.count}</small>
              </h3>
              <div className="cw-skills">
                {SKILLS.filter(([k]) => choice.from.includes(k)).map(([k, label]) => {
                  const fixed = fromBg.includes(k)
                  const on = fixed || skills.includes(k)
                  return (
                    <button
                      key={k}
                      className={`fv-chip ${on ? 'on' : ''}`}
                      disabled={fixed || (!on && skills.length >= choice.count)}
                      title={fixed ? 'From your background' : undefined}
                      onClick={() => setSkills((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </div>
        <footer className="cw-foot">
          <span className="cw-summary">
            {[race?.name, cls?.name, bg?.name].filter(Boolean).join(' · ') || 'Nothing chosen yet: that is fine, the sheet can be filled in by hand.'}
          </span>
          <button className="fv-btn gold" disabled={busy || !arrayOk || !pointsOk} onClick={() => void create()}>
            Create character
          </button>
        </footer>
      </div>
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}

function Choice({ list, value, onChange, detail }: { list: Entry[] | null; value: Entry | null; onChange: (e: Entry | null) => void; detail: (r: Raw) => string }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => (list ?? []).filter((e) => e.name.toLowerCase().includes(q.toLowerCase())).slice(0, 80), [list, q])
  if (list === null) return <div className="cs-empty">Loading from 5etools…</div>
  if (list.length === 0) return <div className="cs-empty">Nothing found in your 5etools.</div>
  return (
    <div className="cw-choice">
      {list.length > 12 && <input className="cw-filter" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="cw-options">
        {shown.map((e) => (
          <button key={`${e.name}|${e.source}`} className={`cw-option ${value === e ? 'on' : ''}`} onClick={() => onChange(value === e ? null : e)}>
            <strong>{e.name}</strong>
            <span>{e.source}</span>
          </button>
        ))}
      </div>
      {value && <div className="cw-detail">{detail(value.raw) || value.name}</div>}
    </div>
  )
}

function openWhenReady(id: string): boolean {
  if (!getState().pages[id]) return false
  openPage(id, 'replace')
  return true
}
