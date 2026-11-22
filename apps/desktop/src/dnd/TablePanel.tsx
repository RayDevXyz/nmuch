import { AlertTriangle, Check, Copy, Eye, EyeOff, Radio, ScrollText, Undo2, Unplug, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast, useApp } from '../state/store'
import { ABILITIES, ABILITY_NAME, mod, signed } from './fivee'
import { getCampaignTable, getTable, setCampaignTable, setTable, useLive, type CharacterRules, type Live, type Submission } from './live'
import { SKILLS } from './rules'
import { approve, characterSources, checkSubmission, sheetFor } from './tableCharacters'

/**
 * The table, seen from BrainWaves: going live (one room per campaign), what map players see,
 * the characters players submitted (approve or send back), and the rules they build by.
 * Used on a campaign's page and in a battle map's panel.
 */

const clean = (e: unknown) => String(e).replace(/^Error:\s*/, '')

/** Live or not, the join link, who's there, and (on a battle map) whether players see it. */
export function LiveSection({ live, title, sceneId, onShow }: { live: Live; title: string; sceneId?: string; onShow?: () => void }) {
  const state = useLive(live)
  const [table, setTableState] = useState<{ server: string; key: string } | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [server, setServer] = useState('')
  const [key, setKey] = useState('')
  const showingTitle = useApp((s) => (state.showing ? s.pages[state.showing]?.title || 'a battle map' : null))
  useEffect(() => {
    void getTable().then(
      (t) => (setTableState(t), setServer(t?.server ?? 'http://'), setKey(t?.key ?? '')),
      () => setTableState(null),
    )
  }, [])
  const save = async () => {
    try {
      await setTable(server, key)
      setTableState({ server: server.trim().replace(/\/+$/, ''), key })
      setEditing(false)
    } catch (e) {
      toast(clean(e))
    }
  }
  if (table === undefined) return null
  if (!table || editing)
    return (
      <section className="sc-sec">
        <h3>Table server</h3>
        <p className="sc-hint">Where your table runs (see the Docker setup in docs/guide/table.md) and its DM key.</p>
        <input className="sc-input" placeholder="http://192.168.1.20:8090" value={server} onChange={(e) => setServer(e.target.value)} />
        <input className="sc-input" type="password" placeholder="DM key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <div className="sc-row">
          <button className="sc-btn gold" onClick={() => void save()}>
            Save
          </button>
          {table && (
            <button className="sc-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
      </section>
    )
  const on = state.status === 'live' || state.status === 'connecting'
  const goLive = async () => {
    try {
      await live.start(table, title)
      onShow?.()
    } catch {
      /* the panel shows the error */
    }
  }
  const here = !!sceneId && state.showing === sceneId
  return (
    <section className="sc-sec">
      <div className="sc-live-row">
        <span className={`sc-dot ${state.status}`} />
        <span className="sc-live-label">{state.status === 'live' ? 'Live' : state.status === 'connecting' ? 'Connecting…' : state.status === 'error' ? 'Not connected' : 'Not live'}</span>
        {on ? (
          <button className="sc-btn" onClick={() => live.end()}>
            <Unplug size={13} /> End
          </button>
        ) : (
          <button className="sc-btn gold" onClick={() => void goLive()}>
            <Radio size={13} /> Go live
          </button>
        )}
      </div>
      {state.error && <p className="sc-error">{state.error}</p>}
      {state.joinUrl && (
        <div className="sc-join" title="One link for the whole campaign">
          <code>{state.joinUrl}</code>
          <button
            className="sc-icon"
            title="Copy the link for your players"
            onClick={() => void navigator.clipboard.writeText(state.joinUrl!).then(() => toast('Join link copied'), () => toast(state.joinUrl!))}
          >
            <Copy size={13} />
          </button>
        </div>
      )}
      {state.status === 'live' && (
        <>
          <div className="sc-showing">
            {here ? (
              <>
                <Eye size={13} /> <span>Players see this map.</span>
                <button className="sc-btn" onClick={() => live.hide()}>
                  <EyeOff size={13} /> Hide
                </button>
              </>
            ) : (
              <>
                <span>{showingTitle ? `Players see ${showingTitle}.` : 'Players see no map.'}</span>
                {onShow && (
                  <button className="sc-btn gold" onClick={onShow}>
                    <Eye size={13} /> Show this map
                  </button>
                )}
              </>
            )}
          </div>
          <p className="sc-players">
            {state.players.length === 0 ? (
              <span className="muted-text">No players yet: send them the link.</span>
            ) : (
              state.players.map((p) => (
                <span key={p.id} className="sc-player">
                  <i style={{ background: p.color }} /> {p.name}
                </span>
              ))
            )}
          </p>
        </>
      )}
      <button className="sc-link" onClick={() => setEditing(true)}>
        Table server: {table.server}
      </button>
    </section>
  )
}

/** Characters players submitted, waiting for the DM. */
export function SubmissionsSection({ live, campaignId }: { live: Live; campaignId: string }) {
  const state = useLive(live)
  const [open, setOpen] = useState<Submission | null>(null)
  const waiting = state.submissions.filter((s) => s.status === 'pending')
  if (state.status !== 'live' && waiting.length === 0) return null
  return (
    <section className="sc-sec">
      <h3>
        <ScrollText size={13} /> Characters to review {waiting.length > 0 && <b className="sc-badge">{waiting.length}</b>}
      </h3>
      {waiting.length === 0 ? (
        <p className="sc-hint">When players build characters on the table site, they wait here for you.</p>
      ) : (
        waiting.map((s) => (
          <button key={s.id} className="sc-sub" onClick={() => setOpen(s)}>
            <b>{s.character.name}</b>
            <span>
              {[s.character.race?.name, s.character.class?.name, s.character.background?.name].filter(Boolean).join(' · ')} — {s.player || 'a player'}
            </span>
          </button>
        ))
      )}
      {open && <ReviewDialog live={live} campaignId={campaignId} sub={open} close={() => setOpen(null)} />}
    </section>
  )
}

function ReviewDialog({ live, campaignId, sub, close }: { live: Live; campaignId: string; sub: Submission; close: () => void }) {
  const [rules, setRules] = useState<CharacterRules | null>(null)
  const [issues, setIssues] = useState<string[] | null>(null)
  const [sheet, setSheet] = useState<Awaited<ReturnType<typeof sheetFor>> | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void getCampaignTable(campaignId).then(async (t) => {
      setRules(t.rules)
      setIssues(await checkSubmission(sub, t.rules))
      setSheet(await sheetFor(sub, t.rules))
    })
  }, [campaignId, sub])
  const c = sub.character
  const yes = async () => {
    if (!rules) return
    setBusy(true)
    try {
      const id = await approve(sub, rules, campaignId)
      live.review(sub, true, note, id)
      toast(`${c.name} joined the party`)
      close()
    } catch (e) {
      toast(`Could not make the character: ${clean(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const no = () => {
    if (!note.trim()) return toast('Tell the player what to change.')
    live.review(sub, false, note.trim())
    toast(`${c.name} went back to ${sub.player || 'the player'}`)
    close()
  }
  return createPortal(
    <div className="sc-modal" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sc-modal-card dnd-theme" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && close())}>
        <button className="sc-icon sc-modal-x" aria-label="Close" onClick={close}>
          <X size={15} />
        </button>
        <h2>{c.name}</h2>
        <p className="sc-hint">
          Built by <b>{sub.player || 'a player'}</b> on the table site · {new Date(sub.at).toLocaleString()}
        </p>
        <p className="sc-review-line">{[c.race && `${c.race.name} (${c.race.source})`, c.class && `${c.class.name} (${c.class.source})`, c.background && `${c.background.name} background`, c.alignment].filter(Boolean).join(' · ')}</p>
        {issues === null ? (
          <p className="sc-hint">Checking against your rules…</p>
        ) : issues.length ? (
          <div className="sc-issues">
            {issues.map((i) => (
              <p key={i}>
                <AlertTriangle size={13} /> {i}
              </p>
            ))}
          </div>
        ) : (
          <p className="sc-ok">
            <Check size={13} /> Within your rules{rules && rules.level > 1 ? `; joins at level ${rules.level}` : ''}.
          </p>
        )}
        {sheet && (
          <>
            <div className="sc-review-abs">
              {ABILITIES.map((a) => (
                <div key={a}>
                  <small>{ABILITY_NAME[a].slice(0, 3)}</small>
                  <b>{sheet.abilities[a]}</b>
                  <span>{signed(mod(sheet.abilities[a]))}</span>
                </div>
              ))}
            </div>
            <p className="sc-review-line">
              HP {sheet.hp.max} · AC {sheet.ac} · Speed {sheet.speed} ft · Skills:{' '}
              {Object.keys(sheet.skills)
                .map((k) => SKILLS.find((x) => x[0] === k)?.[1] ?? k)
                .join(', ') || '—'}
            </p>
          </>
        )}
        {c.backstory && <blockquote className="sc-backstory">{c.backstory}</blockquote>}
        <textarea className="sc-input sc-note" rows={3} placeholder="A note for the player (needed to send it back)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="sc-row sc-review-actions">
          <button className="sc-btn" disabled={busy} onClick={no}>
            <Undo2 size={13} /> Send back
          </button>
          <button className="sc-btn gold" disabled={busy || !rules} onClick={() => void yes()}>
            <Check size={13} /> Approve: add to the party
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** How players build characters for this campaign. */
export function RulesSection({ live, campaignId }: { live: Live; campaignId: string }) {
  const [rules, setRules] = useState<CharacterRules | null>(null)
  const [sources, setSources] = useState<{ source: string; count: number }[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void getCampaignTable(campaignId).then((t) => setRules(t.rules))
  }, [campaignId])
  useEffect(() => {
    if (open && !sources) void characterSources().then(setSources, () => setSources([]))
  }, [open, sources])
  if (!rules) return null
  const save = async (patch: Partial<CharacterRules>) => {
    const next = { ...rules, ...patch }
    setRules(next)
    try {
      await setCampaignTable(campaignId, { rules: next })
      void live.pushRules()
    } catch (e) {
      toast(clean(e))
    }
  }
  const toggleSource = (src: string) => {
    const all = (sources ?? []).map((s) => s.source)
    const cur = rules.sources ?? all
    const next = cur.includes(src) ? cur.filter((x) => x !== src) : [...cur, src]
    void save({ sources: next.length === all.length ? null : next })
  }
  return (
    <section className="sc-sec">
      <h3>Character rules</h3>
      <div className="sc-row">
        <label className="sc-check">
          <input type="checkbox" checked={rules.open} onChange={(e) => void save({ open: e.target.checked })} /> players may submit characters
        </label>
      </div>
      <button className="sc-link" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide the rules' : `Level ${rules.level} · ${rules.method === 'any' ? 'any ability method' : rules.method} · ${rules.sources ? `${rules.sources.length} sources` : 'all sources'}`}
      </button>
      {open && (
        <>
          <div className="sc-grid2">
            <label>
              Starting level
              <input className="sc-input" type="number" min={1} max={20} value={rules.level} onChange={(e) => void save({ level: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
            </label>
            <label>
              Ability scores
              <select className="sc-input" value={rules.method} onChange={(e) => void save({ method: e.target.value as CharacterRules['method'] })}>
                <option value="any">Player's choice</option>
                <option value="standard">Standard array</option>
                <option value="pointbuy">Point buy</option>
                <option value="manual">Rolled (they enter them)</option>
              </select>
            </label>
          </div>
          <p className="sc-hint">Books races, classes and backgrounds may come from:</p>
          {sources === null ? (
            <p className="sc-hint">Reading your compendium…</p>
          ) : sources.length === 0 ? (
            <p className="sc-error">Your compendium isn't reachable: set its address with Ctrl+Shift+D.</p>
          ) : (
            <div className="sc-sources">
              {sources.map((s) => (
                <button key={s.source} className={`sc-chip ${!rules.sources || rules.sources.includes(s.source) ? 'on' : ''}`} onClick={() => toggleSource(s.source)} title={`${s.count} options`}>
                  {s.source}
                </button>
              ))}
            </div>
          )}
          <textarea className="sc-input sc-note" rows={2} placeholder="A note for players (house rules, setting, what fits the campaign)" defaultValue={rules.note} onBlur={(e) => e.target.value !== rules.note && void save({ note: e.target.value })} />
        </>
      )}
    </section>
  )
}
