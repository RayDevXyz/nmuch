import type { ReactNode } from 'react'
import { ABILITIES, ALIGN, CATEGORIES, levelLabel, mod, SCHOOL, signed, SIZE, type Entry, type Raw } from './fivee'
import { Entries, Inline, plainText } from './render'

/** A 5e entry as a card: a monster's stat block, a spell's header, an item's properties, … */
export function Statblock({ entry, compact }: { entry: Entry; compact?: boolean }) {
  const cat = CATEGORIES.find((c) => c.id === entry.cat)!
  return (
    <article className={`fv-card fv-${entry.cat} ${compact ? 'compact' : ''}`}>
      <header className="fv-card-head">
        <div className="fv-card-title">{entry.name}</div>
        <div className="fv-card-sub">
          {subtitle(entry)}
          <span className="fv-card-source" title={`${cat.label} · ${entry.source}${entry.raw.page ? `, p. ${entry.raw.page}` : ''}`}>
            {entry.source}
          </span>
        </div>
      </header>
      <div className="fv-card-body">{body(entry)}</div>
    </article>
  )
}

function subtitle(e: Entry): string {
  const r = e.raw
  switch (e.cat) {
    case 'spell': {
      const lvl = Number(r.level ?? 0)
      const school = SCHOOL[r.school] ?? r.school ?? ''
      return lvl === 0 ? `${school} cantrip` : `${levelLabel(lvl)} ${school.toLowerCase()}${r.meta?.ritual ? ' (ritual)' : ''}`
    }
    case 'monster': {
      const size = (r.size ?? []).map((s: string) => SIZE[s] ?? s).join(' or ')
      const type = typeof r.type === 'string' ? r.type : r.type?.type ?? ''
      const tags = typeof r.type === 'object' && r.type?.tags?.length ? ` (${r.type.tags.map((t: unknown) => (typeof t === 'string' ? t : (t as Raw).tag)).join(', ')})` : ''
      return `${size} ${typeof type === 'string' ? type : (type.choose ?? []).join(' or ')}${tags}, ${alignment(r.alignment)}`
    }
    case 'item':
      return [itemType(r), r.rarity && r.rarity !== 'none' ? r.rarity : '', r.reqAttune ? `(requires attunement${typeof r.reqAttune === 'string' ? ' ' + r.reqAttune : ''})` : '']
        .filter(Boolean)
        .join(', ')
    case 'race':
      return [(r.size ?? []).map((s: string) => SIZE[s] ?? s).join(' or '), r.parentRace ? `${r.parentRace} subrace` : 'Race'].filter(Boolean).join(' · ')
    case 'class':
      return r.hd ? `Hit die d${r.hd.faces}` : 'Class'
    case 'feat':
      return r.prerequisite ? `Prerequisite: ${prerequisite(r.prerequisite)}` : 'Feat'
    default:
      return CATEGORIES.find((c) => c.id === e.cat)!.label
  }
}

function body(e: Entry): ReactNode {
  const r = e.raw
  switch (e.cat) {
    case 'spell':
      return (
        <>
          <dl className="fv-props">
            <Prop k="Casting time" v={(r.time ?? []).map(time).join(' or ')} />
            <Prop k="Range" v={range(r.range)} />
            <Prop k="Components" v={components(r.components)} />
            <Prop k="Duration" v={(r.duration ?? []).map(duration).join(' or ')} />
          </dl>
          <Entries entries={r.entries} />
          <Entries entries={r.entriesHigherLevel} />
          {classList(r).length > 0 && <p className="fv-classes">Classes: {classList(r).join(', ')}</p>}
        </>
      )
    case 'monster':
      return <MonsterBody r={r} />
    case 'item':
      return (
        <>
          <dl className="fv-props">
            {r.dmg1 && <Prop k="Damage" v={`${r.dmg1}${r.dmg2 ? ` (${r.dmg2} versatile)` : ''} ${DMG[r.dmgType] ?? ''}`} />}
            {r.ac != null && <Prop k="Armor class" v={String(r.ac)} />}
            {r.weight != null && <Prop k="Weight" v={`${r.weight} lb.`} />}
            {r.value != null && <Prop k="Value" v={coins(r.value)} />}
          </dl>
          <Entries entries={r.entries} />
        </>
      )
    case 'race':
      return (
        <>
          <dl className="fv-props">
            {r.ability?.length > 0 && <Prop k="Ability scores" v={asi(r.ability)} />}
            {r.speed != null && <Prop k="Speed" v={speed(r.speed)} />}
            {r.darkvision && <Prop k="Darkvision" v={`${r.darkvision} ft.`} />}
          </dl>
          <Entries entries={r.entries} />
        </>
      )
    case 'class':
      return (
        <>
          <dl className="fv-props">
            {r.proficiency && <Prop k="Saving throws" v={r.proficiency.map((a: string) => a.toUpperCase()).join(', ')} />}
            {r.spellcastingAbility && <Prop k="Spellcasting" v={`${r.spellcastingAbility.toUpperCase()} (${r.casterProgression ?? 'full'} caster)`} />}
            {r.startingProficiencies?.armor && <Prop k="Armor" v={r.startingProficiencies.armor.map((x: unknown) => plainText(String(typeof x === 'string' ? x : (x as Raw).proficiency ?? ''))).join(', ')} />}
            {r.startingProficiencies?.weapons && <Prop k="Weapons" v={r.startingProficiencies.weapons.map((x: unknown) => plainText(String(typeof x === 'string' ? x : (x as Raw).proficiency ?? ''))).join(', ')} />}
          </dl>
          {(r.features ?? []).length > 0 && (
            <div className="fv-features">
              {[...r.features].sort((a: Raw, b: Raw) => a.level - b.level).map((f: Raw, i: number) => (
                <section key={i} className="fv-section">
                  <h5 className="fv-h">
                    <span className="fv-level">{f.level}</span> {f.name}
                  </h5>
                  <Entries entries={f.entries} depth={1} />
                </section>
              ))}
            </div>
          )}
        </>
      )
    default:
      return <Entries entries={r.entries} />
  }
}

function MonsterBody({ r }: { r: Raw }) {
  const saves = r.save ? Object.entries(r.save).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ') : ''
  const skills = r.skill ? Object.entries(r.skill).filter(([k]) => k !== 'other').map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v}`).join(', ') : ''
  const list = (x: unknown) => (Array.isArray(x) ? x.map((v) => (typeof v === 'string' ? v : (v as Raw).special ?? (v as Raw)[Object.keys(v as Raw).find((k) => Array.isArray((v as Raw)[k])) ?? ''] ?? '')).flat().join(', ') : '')
  const block = (title: string, items: Raw[] | undefined) =>
    items?.length ? (
      <section className="fv-mon-section">
        {title && <h5 className="fv-mon-h">{title}</h5>}
        {items.map((t, i) => (
          <div key={i} className="fv-mon-trait">
            <strong><Inline text={String(t.name ?? '')} />.</strong> <Entries entries={t.entries} depth={2} />
          </div>
        ))}
      </section>
    ) : null
  return (
    <>
      <dl className="fv-props">
        <Prop k="Armor Class" v={(r.ac ?? []).map((a: unknown) => (typeof a === 'number' ? String(a) : `${(a as Raw).ac}${(a as Raw).from ? ` (${(a as Raw).from.join(', ')})` : ''}`)).join(', ')} />
        <Prop k="Hit Points" v={r.hp ? (r.hp.special ?? `${r.hp.average} (${r.hp.formula})`) : ''} />
        <Prop k="Speed" v={speed(r.speed)} />
      </dl>
      <div className="fv-abilities">
        {ABILITIES.map((a) => (
          <div key={a}>
            <span>{a.toUpperCase()}</span>
            <strong>{r[a] ?? '—'}</strong>
            <em>{typeof r[a] === 'number' ? signed(mod(r[a])) : ''}</em>
          </div>
        ))}
      </div>
      <dl className="fv-props">
        {saves && <Prop k="Saving Throws" v={saves} />}
        {skills && <Prop k="Skills" v={skills} />}
        {r.resist && <Prop k="Damage Resistances" v={list(r.resist)} />}
        {r.immune && <Prop k="Damage Immunities" v={list(r.immune)} />}
        {r.conditionImmune && <Prop k="Condition Immunities" v={list(r.conditionImmune)} />}
        <Prop k="Senses" v={[...(r.senses ?? []), `passive Perception ${r.passive ?? '—'}`].join(', ')} />
        <Prop k="Languages" v={(r.languages ?? []).join(', ') || '—'} />
        <Prop k="Challenge" v={cr(r.cr)} />
      </dl>
      {block('', r.trait)}
      {block('Actions', r.action)}
      {block('Bonus Actions', r.bonus)}
      {block('Reactions', r.reaction)}
      {block('Legendary Actions', r.legendary)}
    </>
  )
}

function Prop({ k, v }: { k: string; v: string }) {
  if (!v) return null
  return (
    <div className="fv-prop">
      <dt>{k}</dt>
      <dd><Inline text={v} /></dd>
    </div>
  )
}

// ---- formatting helpers

const DMG: Record<string, string> = { A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', P: 'piercing', I: 'poison', Y: 'psychic', R: 'radiant', S: 'slashing', T: 'thunder' }
const ITEM_TYPE: Record<string, string> = { M: 'Melee weapon', R: 'Ranged weapon', A: 'Ammunition', LA: 'Light armor', MA: 'Medium armor', HA: 'Heavy armor', S: 'Shield', P: 'Potion', RG: 'Ring', RD: 'Rod', WD: 'Wand', SC: 'Scroll', G: 'Adventuring gear', W: 'Wondrous item', INS: 'Instrument', T: 'Tools', AT: "Artisan's tools", GS: 'Gaming set', MNT: 'Mount', VEH: 'Vehicle', FD: 'Food and drink', TG: 'Trade good', $: 'Treasure' }

function itemType(r: Raw): string {
  const t = String(r.type ?? '').split('|')[0]
  if (r.wondrous) return 'Wondrous item'
  return ITEM_TYPE[t] ?? (r.weaponCategory ? `${r.weaponCategory} weapon` : 'Item')
}

function alignment(a: unknown): string {
  if (!Array.isArray(a)) return ''
  if (a.length === 1 && typeof a[0] === 'string') return ALIGN[a[0]] ?? a[0]
  if (a.every((x) => typeof x === 'string')) return a.map((x) => ALIGN[x] ?? x).join(' ')
  return a.map((x) => (typeof x === 'string' ? ALIGN[x] ?? x : (x as Raw).special ?? ((x as Raw).alignment ?? []).map((y: string) => ALIGN[y] ?? y).join(' '))).join(' or ')
}

function time(t: Raw): string {
  return `${t.number} ${t.unit === 'bonus' ? 'bonus action' : t.unit}${t.number > 1 && t.unit !== 'bonus' ? 's' : ''}${t.condition ? `, ${plainText(t.condition)}` : ''}`
}

function range(r: Raw | undefined): string {
  if (!r) return ''
  const d = r.distance ?? {}
  if (r.type === 'special') return 'Special'
  if (d.type === 'self' || d.type === 'touch' || d.type === 'sight' || d.type === 'unlimited') {
    const base = d.type[0].toUpperCase() + d.type.slice(1)
    return ['cone', 'line', 'radius', 'sphere', 'cube', 'hemisphere'].includes(r.type) ? `${base} (${d.amount}-foot ${r.type})` : base
  }
  if (['cone', 'line', 'radius', 'sphere', 'cube', 'hemisphere'].includes(r.type)) return `Self (${d.amount}-${d.type === 'miles' ? 'mile' : 'foot'} ${r.type})`
  return `${d.amount} ${d.type}`
}

function components(c: Raw | undefined): string {
  if (!c) return ''
  const m = c.m ? (typeof c.m === 'string' ? c.m : c.m.text) : ''
  return [c.v && 'V', c.s && 'S', c.m && `M (${m})`].filter(Boolean).join(', ')
}

function duration(d: Raw): string {
  if (d.type === 'instant') return 'Instantaneous'
  if (d.type === 'permanent') return `Until dispelled${d.ends?.includes('trigger') ? ' or triggered' : ''}`
  if (d.type === 'special') return 'Special'
  if (d.type === 'timed') {
    const n = d.duration?.amount ?? 1
    const u = d.duration?.type ?? ''
    return `${d.concentration ? 'Concentration, up to ' : ''}${n} ${u}${n > 1 ? 's' : ''}`
  }
  return String(d.type ?? '')
}

function speed(s: unknown): string {
  if (typeof s === 'number') return `${s} ft.`
  if (!s || typeof s !== 'object') return ''
  return Object.entries(s as Raw)
    .filter(([k]) => k !== 'canHover' && k !== 'choose')
    .map(([k, v]) => {
      const n = typeof v === 'object' ? (v as Raw).number : v
      return k === 'walk' ? `${n} ft.` : `${k} ${n} ft.`
    })
    .join(', ')
}

function cr(c: unknown): string {
  const v = typeof c === 'object' && c ? (c as Raw).cr : c
  const xp: Record<string, number> = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900 }
  return v == null ? '—' : `${v}${xp[String(v)] ? ` (${xp[String(v)].toLocaleString()} XP)` : ''}`
}

function coins(cp: number): string {
  if (cp >= 100 && cp % 100 === 0) return `${cp / 100} gp`
  if (cp >= 10 && cp % 10 === 0) return `${cp / 10} sp`
  return `${cp} cp`
}

export function asi(ability: Raw[]): string {
  return ability
    .map((a) =>
      Object.entries(a)
        .filter(([k]) => k !== 'choose')
        .map(([k, v]) => `${k.toUpperCase()} ${signed(Number(v))}`)
        .concat(a.choose ? [`choose ${a.choose.count ?? 1} ${signed(a.choose.amount ?? 1)}`] : [])
        .join(', '),
    )
    .join('; ')
}

function prerequisite(p: Raw[]): string {
  return p
    .map((x) =>
      [
        x.ability?.map((a: Raw) => Object.entries(a).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' or ')).join(', '),
        x.level ? `level ${typeof x.level === 'object' ? x.level.level : x.level}` : '',
        x.race?.map((r: Raw) => r.name).join(' or '),
        x.spellcasting ? 'the ability to cast at least one spell' : '',
        x.other,
      ]
        .filter(Boolean)
        .join(', '),
    )
    .join('; or ')
}

function classList(r: Raw): string[] {
  return (r.classes?.fromClassList ?? []).map((c: Raw) => c.name)
}
