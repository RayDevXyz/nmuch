import { coreClient } from '../lib/storage'

/**
 * 5e content from the user's own 5etools site. The host fetches `data/*.json` files from the
 * address set in the compendium's settings (`crates/bw-api/src/fivee.rs`); nothing is stored in
 * the workspace except references (category, name, source).
 */

export type Category = 'spell' | 'monster' | 'item' | 'race' | 'class' | 'background' | 'feat' | 'condition'

export const CATEGORIES: { id: Category; label: string; plural: string; icon: string }[] = [
  { id: 'spell', label: 'Spell', plural: 'Spells', icon: '✦' },
  { id: 'monster', label: 'Monster', plural: 'Bestiary', icon: '☠' },
  { id: 'item', label: 'Item', plural: 'Items', icon: '⚔' },
  { id: 'race', label: 'Race', plural: 'Races', icon: '⚘' },
  { id: 'class', label: 'Class', plural: 'Classes', icon: '⚜' },
  { id: 'background', label: 'Background', plural: 'Backgrounds', icon: '✎' },
  { id: 'feat', label: 'Feat', plural: 'Feats', icon: '✧' },
  { id: 'condition', label: 'Condition', plural: 'Conditions', icon: '◈' },
]

/** One 5etools entry, as found in its file (shapes differ per category). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>

export interface Entry {
  cat: Category
  name: string
  source: string
  raw: Raw
}

/** How a page refers to an entry. */
export interface Ref {
  cat: Category
  name: string
  source: string
}

export const keyOf = (r: Ref) => `${r.cat}|${r.name.toLowerCase()}|${r.source.toLowerCase()}`

export const fetchData = (path: string, fresh = false) => coreClient().call<unknown>('fiveeFetch', { path, fresh })
export const getSource = () => coreClient().call<string | null>('dndSource')
export const setSource = (url: string) => coreClient().call<string>('dndSetSource', { url })

// ---- which books to use

/** The books (5etools source ids) the user turned on; null: all of them. */
let enabled: Set<string> | null | undefined
let enabledLoad: Promise<Set<string> | null> | null = null
export function enabledSources(): Promise<Set<string> | null> {
  if (enabled !== undefined) return Promise.resolve(enabled)
  enabledLoad ??= coreClient()
    .call<string[] | null>('dndSources')
    .then(
      (l) => (enabled = l ? new Set(l.map((x) => x.toUpperCase())) : null),
      () => (enabled = null),
    )
  return enabledLoad
}
export async function setEnabledSources(list: string[] | null) {
  await coreClient().call('dndSetSources', { sources: list })
  enabled = list ? new Set(list.map((x) => x.toUpperCase())) : null
  enabledLoad = null
}

export interface Book {
  id: string
  name: string
  /** core, supplement, setting, adventure, … */
  group: string
  published?: string
}

/** The books and adventures the user's 5etools knows (data/books.json, data/adventures.json). */
export async function listBooks(): Promise<Book[]> {
  const [books, advs] = await Promise.all([optional('data/books.json'), optional('data/adventures.json')])
  const out: Book[] = []
  for (const b of (books.book ?? []) as Raw[]) out.push({ id: String(b.id ?? b.source), name: String(b.name), group: String(b.group ?? 'other'), published: b.published })
  for (const a of (advs.adventure ?? []) as Raw[]) out.push({ id: String(a.id ?? a.source), name: String(a.name), group: 'adventure', published: a.published })
  const seen = new Set<string>()
  return out.filter((b) => b.id && !seen.has(b.id.toUpperCase()) && seen.add(b.id.toUpperCase()))
}

/** A file that may not exist in every 5etools version: missing → empty. */
async function optional(path: string): Promise<Raw> {
  try {
    return (await fetchData(path)) as Raw
  } catch (e) {
    if (/isn't on your 5etools site/.test(String(e))) return {}
    throw e
  }
}

/** Files listed in an index.json (`{ "PHB": "spells-phb.json", … }`). */
async function indexed(dir: string, key: string): Promise<Raw[]> {
  const index = (await optional(`data/${dir}/index.json`)) as Record<string, string>
  const files = [...new Set(Object.values(index))]
  const parts = await Promise.all(files.map((f) => optional(`data/${dir}/${f}`).catch(() => ({}) as Raw)))
  return parts.flatMap((p) => (Array.isArray(p[key]) ? p[key] : []))
}

/**
 * Entries that copy another one (`_copy`: a variant monster, a renamed item) get the original's
 * fields first. 5etools' `_mod` edits are not applied: the copy's own fields win, which covers
 * most of what a reader needs.
 */
function resolveCopies(list: Raw[]): Raw[] {
  const by = new Map(list.map((x) => [`${String(x.name).toLowerCase()}|${String(x.source).toLowerCase()}`, x]))
  const resolve = (x: Raw, depth = 0): Raw => {
    const c = x._copy
    if (!c || depth > 4) return x
    const base = by.get(`${String(c.name).toLowerCase()}|${String(c.source).toLowerCase()}`)
    if (!base) return x
    const { _copy, ...rest } = x
    return { ...resolve(base, depth + 1), ...rest }
  }
  return list.map((x) => resolve(x))
}

async function load(cat: Category): Promise<Raw[]> {
  switch (cat) {
    case 'spell':
      return indexed('spells', 'spell')
    case 'monster':
      return resolveCopies(await indexed('bestiary', 'monster'))
    case 'item': {
      const [items, base] = await Promise.all([optional('data/items.json'), optional('data/items-base.json')])
      return resolveCopies([...(base.baseitem ?? []), ...(items.item ?? [])])
    }
    case 'race': {
      const r = await optional('data/races.json')
      const races: Raw[] = r.race ?? []
      // Subraces become their own entries, "High Elf", with the race's fields underneath.
      const subs: Raw[] = (r.subrace ?? [])
        .filter((s: Raw) => s.name)
        .map((s: Raw) => {
          const parent = races.find((x) => x.name === s.raceName && x.source === s.raceSource) ?? {}
          return {
            ...parent,
            ...s,
            name: `${s.name} ${s.raceName}`,
            parentRace: s.raceName,
            ability: [...(parent.ability ?? []), ...(s.ability ?? [])],
            entries: [...(parent.entries ?? []), ...(s.entries ?? [])],
          }
        })
      return [...races, ...subs]
    }
    case 'class': {
      const index = (await optional('data/class/index.json')) as Record<string, string>
      const files = await Promise.all([...new Set(Object.values(index))].map((f) => optional(`data/class/${f}`)))
      // Each class carries its own features, so a sheet or a card can list them by level.
      return files.flatMap((f) =>
        (f.class ?? []).map((c: Raw) => ({
          ...c,
          features: (f.classFeature ?? []).filter((x: Raw) => x.className === c.name && x.classSource === c.source),
          subclasses: (f.subclass ?? []).filter((x: Raw) => x.className === c.name && x.classSource === c.source),
        })),
      )
    }
    case 'background':
      return resolveCopies((await optional('data/backgrounds.json')).background ?? [])
    case 'feat':
      return (await optional('data/feats.json')).feat ?? []
    case 'condition': {
      const d = await optional('data/conditionsdiseases.json')
      return [...(d.condition ?? []), ...(d.disease ?? []), ...(d.status ?? [])]
    }
  }
}

const loaded = new Map<Category, Promise<Entry[]>>()

/** The entries of a category from the books the user turned on. */
export async function entries(cat: Category): Promise<Entry[]> {
  const [list, on] = await Promise.all([allEntries(cat), enabledSources()])
  return on ? list.filter((e) => on.has(e.source.toUpperCase())) : list
}

/** All entries of a category, whatever books are turned on (fetched once per session; `reload` to fetch again). */
export function allEntries(cat: Category): Promise<Entry[]> {
  let p = loaded.get(cat)
  if (!p) {
    p = load(cat).then((list) =>
      list
        .filter((x) => x && typeof x.name === 'string')
        .map((raw) => ({ cat, name: raw.name as string, source: String(raw.source ?? ''), raw }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    p.catch(() => loaded.delete(cat))
    loaded.set(cat, p)
  }
  return p
}

export function reload() {
  loaded.clear()
}

/** Find one entry; without a source, the first by name (preferring core books). */
export async function find(ref: { cat: Category; name: string; source?: string }): Promise<Entry | null> {
  // Every book: a card already in a page keeps working after its book is turned off.
  const list = await allEntries(ref.cat)
  const name = ref.name.toLowerCase()
  const same = list.filter((e) => e.name.toLowerCase() === name)
  if (!same.length) return null
  if (ref.source) {
    const exact = same.find((e) => e.source.toLowerCase() === ref.source!.toLowerCase())
    if (exact) return exact
  }
  const core = ['xphb', 'phb', 'mm', 'xmm', 'dmg', 'xdmg']
  return same.sort((a, b) => rank(a.source) - rank(b.source))[0]
  function rank(s: string) {
    const i = core.indexOf(s.toLowerCase())
    return i < 0 ? 99 : i
  }
}

/** Search names across categories: prefix matches first, then the rest. */
export async function search(q: string, cats: Category[], limit = 60): Promise<Entry[]> {
  const query = q.trim().toLowerCase()
  const lists = await Promise.all(cats.map((c) => entries(c).catch(() => [] as Entry[])))
  const all = lists.flat()
  if (!query) return all.slice(0, limit)
  const starts: Entry[] = []
  const has: Entry[] = []
  for (const e of all) {
    const n = e.name.toLowerCase()
    if (n.startsWith(query)) starts.push(e)
    else if (n.includes(query)) has.push(e)
    if (starts.length >= limit) break
  }
  return [...starts, ...has].slice(0, limit)
}

// ---- small helpers shared by cards and sheets

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Ability = (typeof ABILITIES)[number]
export const ABILITY_NAME: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
export const mod = (score: number) => Math.floor((score - 10) / 2)
export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

export const SCHOOL: Record<string, string> = { A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment', V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation', P: 'Psionic' }
export const SIZE: Record<string, string> = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', V: 'Varies' }
export const ALIGN: Record<string, string> = { L: 'lawful', N: 'neutral', C: 'chaotic', G: 'good', E: 'evil', U: 'unaligned', A: 'any alignment' }

export const levelLabel = (lvl: number) => (lvl === 0 ? 'Cantrip' : `${lvl}${lvl === 1 ? 'st' : lvl === 2 ? 'nd' : lvl === 3 ? 'rd' : 'th'} level`)
