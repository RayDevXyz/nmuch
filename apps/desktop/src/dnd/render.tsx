import { createContext, Fragment, useContext, type ReactNode } from 'react'
import type { Category, Raw, Ref } from './fivee'

/**
 * Renders 5etools' entry format: strings with `{@tag …}` markup, and nested objects (`entries`,
 * `list`, `table`, `inset`, `quote`, …). References to other entries (`{@spell fireball}`)
 * become links; dice, attacks and the like read as text.
 */

/** What a reference link does (open it in the compendium, usually). */
export const OpenRef = createContext<((r: Ref) => void) | null>(null)

const REF_TAGS: Record<string, Category> = {
  spell: 'spell',
  creature: 'monster',
  item: 'item',
  race: 'race',
  class: 'class',
  background: 'background',
  feat: 'feat',
  condition: 'condition',
  disease: 'condition',
  status: 'condition',
}

const DEFAULT_SOURCE: Partial<Record<Category, string>> = {
  spell: 'PHB',
  monster: 'MM',
  item: 'DMG',
  race: 'PHB',
  class: 'PHB',
  background: 'PHB',
  feat: 'PHB',
  condition: 'PHB',
}

const ATK: Record<string, string> = {
  mw: 'Melee Weapon Attack:',
  rw: 'Ranged Weapon Attack:',
  'mw,rw': 'Melee or Ranged Weapon Attack:',
  ms: 'Melee Spell Attack:',
  rs: 'Ranged Spell Attack:',
  'ms,rs': 'Melee or Ranged Spell Attack:',
  m: 'Melee Attack:',
  r: 'Ranged Attack:',
}

/** Split `text` into plain runs and `{@tag body}` (bodies may nest). */
function tokens(text: string): ({ t: string } | { tag: string; body: string })[] {
  const out: ({ t: string } | { tag: string; body: string })[] = []
  let i = 0
  let plain = ''
  while (i < text.length) {
    if (text.startsWith('{@', i)) {
      let depth = 0
      let j = i
      for (; j < text.length; j++) {
        if (text[j] === '{') depth++
        else if (text[j] === '}' && --depth === 0) break
      }
      if (j >= text.length) break
      if (plain) out.push({ t: plain }), (plain = '')
      const inner = text.slice(i + 2, j)
      const sp = inner.indexOf(' ')
      out.push(sp < 0 ? { tag: inner, body: '' } : { tag: inner.slice(0, sp), body: inner.slice(sp + 1) })
      i = j + 1
    } else {
      plain += text[i++]
    }
  }
  plain += text.slice(i)
  if (plain) out.push({ t: plain })
  return out
}

/** Plain text of a tagged string (for titles, search, the index). */
export function plainText(text: string): string {
  return tokens(text)
    .map((x) => ('t' in x ? x.t : tagText(x.tag, x.body)))
    .join('')
}

function tagText(tag: string, body: string): string {
  const parts = body.split('|')
  switch (tag) {
    case 'atk':
      return ATK[body] ?? 'Attack:'
    case 'h':
      return 'Hit: '
    case 'hit':
      return Number(body) >= 0 ? `+${body}` : body
    case 'dc':
      return `DC ${parts[0]}`
    case 'recharge':
      return body ? `(Recharge ${body}–6)` : '(Recharge 6)'
    case 'chance':
      return parts[1] ?? `${parts[0]} percent`
    case 'scaledamage':
    case 'scaledice':
      return parts[2] ?? parts[0]
    case 'd20':
      return parts[1] ?? (/^[+-]?\d+$/.test(parts[0]) ? (Number(parts[0]) >= 0 ? `+${parts[0]}` : parts[0]) : parts[0])
    case 'filter':
      return parts[0]
    default:
      // `{@x name|source|display}`: the display text if given, else the name.
      return parts[2] || parts[0]
  }
}

export function Inline({ text }: { text: string }) {
  const open = useContext(OpenRef)
  return (
    <>
      {tokens(text).map((x, i) => {
        if ('t' in x) return <Fragment key={i}>{x.t}</Fragment>
        const { tag, body } = x
        const parts = body.split('|')
        switch (tag) {
          case 'b':
          case 'bold':
            return <strong key={i}><Inline text={body} /></strong>
          case 'i':
          case 'italic':
            return <em key={i}><Inline text={body} /></em>
          case 's':
          case 'strike':
            return <s key={i}><Inline text={body} /></s>
          case 'u':
          case 'underline':
            return <u key={i}><Inline text={body} /></u>
          case 'note':
            return <span key={i} className="fv-note"><Inline text={body} /></span>
          case 'atk':
          case 'h':
            return <em key={i}>{tagText(tag, body)} </em>
          case 'dice':
          case 'damage':
          case 'hit':
          case 'd20':
          case 'scaledamage':
          case 'scaledice':
          case 'dc':
          case 'chance':
          case 'recharge':
            return <span key={i} className="fv-roll">{tagText(tag, body)}</span>
        }
        const cat = REF_TAGS[tag]
        if (cat) {
          const ref: Ref = { cat, name: parts[0], source: parts[1] || DEFAULT_SOURCE[cat] || '' }
          const label = parts[2] || parts[0]
          return open ? (
            <a key={i} className="fv-link" onClick={(e) => (e.preventDefault(), e.stopPropagation(), open(ref))} href="#">
              {label}
            </a>
          ) : (
            <span key={i} className="fv-link">{label}</span>
          )
        }
        return <Fragment key={i}>{tagText(tag, body)}</Fragment>
      })}
    </>
  )
}

/** One entry or a list of them. `depth` sets heading levels for named sections. */
export function Entries({ entries, depth = 0 }: { entries: unknown; depth?: number }): ReactNode {
  if (entries == null) return null
  if (!Array.isArray(entries)) return <Entry e={entries} depth={depth} />
  return (
    <>
      {entries.map((e, i) => (
        <Entry key={i} e={e} depth={depth} />
      ))}
    </>
  )
}

function Entry({ e, depth }: { e: unknown; depth: number }): ReactNode {
  if (typeof e === 'string') return <p className="fv-p"><Inline text={e} /></p>
  if (typeof e === 'number') return <p className="fv-p">{e}</p>
  if (!e || typeof e !== 'object') return null
  const o = e as Raw
  switch (o.type) {
    case 'list':
      return (
        <ul className={`fv-list ${o.style ?? ''}`}>
          {(o.items ?? []).map((it: unknown, i: number) => (
            <li key={i}>
              {typeof it === 'string' ? <Inline text={it} /> : <ListItem it={it as Raw} depth={depth} />}
            </li>
          ))}
        </ul>
      )
    case 'item':
    case 'itemSub':
    case 'itemSpell':
      return <ListItem it={o} depth={depth} />
    case 'table':
      return <Table t={o} />
    case 'inset':
    case 'insetReadaloud':
      return (
        <aside className={`fv-inset ${o.type === 'insetReadaloud' ? 'readaloud' : ''}`}>
          {o.name && <div className="fv-inset-title">{o.name}</div>}
          <Entries entries={o.entries} depth={depth + 1} />
        </aside>
      )
    case 'quote':
      return (
        <blockquote className="fv-quote">
          <Entries entries={o.entries} depth={depth + 1} />
          {o.by && <footer>— {o.by}{o.from ? `, ${o.from}` : ''}</footer>}
        </blockquote>
      )
    case 'abilityDc':
      return <p className="fv-p fv-center"><strong>{o.name} save DC</strong> = 8 + your proficiency bonus + your {(o.attributes ?? []).join('/')} modifier</p>
    case 'abilityAttackMod':
      return <p className="fv-p fv-center"><strong>{o.name} attack modifier</strong> = your proficiency bonus + your {(o.attributes ?? []).join('/')} modifier</p>
    case 'link':
      return <span><Inline text={String(o.text ?? '')} /></span>
    case 'image':
    case 'gallery':
      return null
    default: {
      // entries / section / options / variant…: a named block of entries.
      const H = depth === 0 ? 'h4' : 'h5'
      return (
        <section className="fv-section">
          {o.name && <H className="fv-h">{plainText(String(o.name))}</H>}
          <Entries entries={o.entries ?? o.entry ?? o.items} depth={depth + 1} />
        </section>
      )
    }
  }
}

function ListItem({ it, depth }: { it: Raw; depth: number }) {
  return (
    <>
      {it.name && <strong className="fv-item-name"><Inline text={String(it.name)} /> </strong>}
      {typeof it.entry === 'string' ? <Inline text={it.entry} /> : <Entries entries={it.entry ?? it.entries} depth={depth + 1} />}
    </>
  )
}

function cell(c: unknown): ReactNode {
  if (typeof c === 'string') return <Inline text={c} />
  if (typeof c === 'number') return c
  if (c && typeof c === 'object') {
    const o = c as Raw
    if (o.roll) return o.roll.exact ?? (o.roll.min === o.roll.max ? o.roll.min : `${o.roll.min}–${o.roll.max}`)
    if (o.entry) return <Inline text={String(o.entry)} />
    return <Entries entries={o} />
  }
  return null
}

function Table({ t }: { t: Raw }) {
  return (
    <table className="fv-table">
      {t.caption && <caption>{t.caption}</caption>}
      {t.colLabels && (
        <thead>
          <tr>
            {t.colLabels.map((l: string, i: number) => (
              <th key={i}><Inline text={l} /></th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {(t.rows ?? []).map((r: unknown, i: number) => {
          const row = Array.isArray(r) ? r : ((r as Raw).row ?? [])
          return (
            <tr key={i}>
              {row.map((c: unknown, j: number) => (
                <td key={j}>{cell(c)}</td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
