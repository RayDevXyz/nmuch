import { ABILITIES, mod, type Ability, type Raw } from './fivee'

/**
 * A character sheet, as stored on the character's page (`dnd.sheet`). Everything that follows
 * from the rules (modifiers, proficiency, save and skill bonuses, spell slots) is computed, not
 * stored, so it stays right when the level or a score changes.
 */
export interface Sheet {
  version: 1
  player?: string
  race?: string
  raceSource?: string
  class?: string
  classSource?: string
  subclass?: string
  /** "Wizard 3": what the Characters table shows. */
  classLabel?: string
  background?: string
  backgroundSource?: string
  alignment?: string
  level: number
  xp: number
  /** Final scores, racial bonuses included. */
  abilities: Record<Ability, number>
  /** Saving throws the character is proficient in. */
  saves: Ability[]
  /** 1 = proficient, 2 = expertise. */
  skills: Record<string, 1 | 2>
  hp: { current: number; max: number; temp: number }
  hitDie: number
  hitDiceUsed: number
  ac: number
  speed: number
  initiativeBonus: number
  deathSaves: { success: number; fail: number }
  inspiration: boolean
  conditions: string[]
  /** Spellcasting from the class: which ability and how slots progress. */
  casting?: { ability: Ability; progression: Progression }
  /** Spent slots per spell level (index 0 = 1st level). */
  slotsUsed: number[]
  spells: { name: string; source: string; prepared?: boolean }[]
  inventory: { name: string; source?: string; qty: number; equipped?: boolean }[]
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number }
  /** Short status lines, like "Well rested". */
  status: string[]
}

export type Progression = 'full' | '1/2' | '1/3' | 'pact' | 'artificer'

export const SKILLS: [string, string, Ability][] = [
  ['acrobatics', 'Acrobatics', 'dex'],
  ['animal handling', 'Animal Handling', 'wis'],
  ['arcana', 'Arcana', 'int'],
  ['athletics', 'Athletics', 'str'],
  ['deception', 'Deception', 'cha'],
  ['history', 'History', 'int'],
  ['insight', 'Insight', 'wis'],
  ['intimidation', 'Intimidation', 'cha'],
  ['investigation', 'Investigation', 'int'],
  ['medicine', 'Medicine', 'wis'],
  ['nature', 'Nature', 'int'],
  ['perception', 'Perception', 'wis'],
  ['performance', 'Performance', 'cha'],
  ['persuasion', 'Persuasion', 'cha'],
  ['religion', 'Religion', 'int'],
  ['sleight of hand', 'Sleight of Hand', 'dex'],
  ['stealth', 'Stealth', 'dex'],
  ['survival', 'Survival', 'wis'],
]

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
export const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }

export const XP_FOR_LEVEL = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]

export const profBonus = (level: number) => Math.ceil(Math.max(1, level) / 4) + 1

export function saveBonus(s: Sheet, a: Ability) {
  return mod(s.abilities[a]) + (s.saves.includes(a) ? profBonus(s.level) : 0)
}

export function skillBonus(s: Sheet, skill: string, a: Ability) {
  return mod(s.abilities[a]) + (s.skills[skill] ?? 0) * profBonus(s.level)
}

export const passivePerception = (s: Sheet) => 10 + skillBonus(s, 'perception', 'wis')
export const initiative = (s: Sheet) => mod(s.abilities.dex) + (s.initiativeBonus ?? 0)

const FULL: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
]

/** Spell slots per spell level for a class level, and (warlocks) the slot level. */
export function slots(progression: Progression | undefined, level: number): { counts: number[]; pactLevel?: number } {
  if (!progression) return { counts: [] }
  if (progression === 'pact') {
    const n = level < 2 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4
    const slotLevel = Math.min(5, Math.ceil(level / 2))
    const counts = Array(slotLevel).fill(0)
    counts[slotLevel - 1] = n
    return { counts, pactLevel: slotLevel }
  }
  const effective =
    progression === 'full' ? level : progression === 'artificer' ? Math.ceil(level / 2) : progression === '1/2' ? (level < 2 ? 0 : Math.floor(level / 2)) : level < 3 ? 0 : Math.floor(level / 3)
  return { counts: effective > 0 ? FULL[Math.min(20, effective) - 1] : [] }
}

export const spellDc = (s: Sheet) => (s.casting ? 8 + profBonus(s.level) + mod(s.abilities[s.casting.ability]) : null)
export const spellAttack = (s: Sheet) => (s.casting ? profBonus(s.level) + mod(s.abilities[s.casting.ability]) : null)

export function emptySheet(): Sheet {
  return {
    version: 1,
    level: 1,
    xp: 0,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: [],
    skills: {},
    hp: { current: 8, max: 8, temp: 0 },
    hitDie: 8,
    hitDiceUsed: 0,
    ac: 10,
    speed: 30,
    initiativeBonus: 0,
    deathSaves: { success: 0, fail: 0 },
    inspiration: false,
    conditions: [],
    slotsUsed: [],
    spells: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    status: [],
  }
}

/** Fixed racial ability bonuses (a race's "choose" bonuses are left to the player). */
export function racialBonuses(race: Raw | null): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {}
  for (const a of race?.ability ?? []) {
    for (const ab of ABILITIES) if (typeof a[ab] === 'number') out[ab] = (out[ab] ?? 0) + a[ab]
  }
  return out
}

/** Skills a background gives outright. */
export function backgroundSkills(bg: Raw | null): string[] {
  const out: string[] = []
  for (const block of bg?.skillProficiencies ?? []) for (const [k, v] of Object.entries(block)) if (v === true) out.push(k)
  return out
}

/** The class's skill choice: from which skills, how many. */
export function classSkillChoice(cls: Raw | null): { from: string[]; count: number } {
  for (const s of cls?.startingProficiencies?.skills ?? []) {
    const c = s.choose
    if (c) return { from: c.from ?? SKILLS.map((x) => x[0]), count: c.count ?? 2 }
    if (s.any) return { from: SKILLS.map((x) => x[0]), count: s.any }
  }
  return { from: [], count: 0 }
}

/** A level-1 sheet from the wizard's choices. */
export function buildSheet(opts: {
  player: string
  race: Raw | null
  cls: Raw | null
  background: Raw | null
  base: Record<Ability, number>
  skills: string[]
}): Sheet {
  const s = emptySheet()
  const bonus = racialBonuses(opts.race)
  for (const a of ABILITIES) s.abilities[a] = opts.base[a] + (bonus[a] ?? 0)
  s.player = opts.player || undefined
  if (opts.race) {
    s.race = opts.race.name
    s.raceSource = opts.race.source
    s.speed = typeof opts.race.speed === 'number' ? opts.race.speed : (opts.race.speed?.walk ?? 30)
  }
  if (opts.cls) {
    s.class = opts.cls.name
    s.classSource = opts.cls.source
    s.classLabel = `${opts.cls.name} 1`
    s.hitDie = opts.cls.hd?.faces ?? 8
    s.saves = (opts.cls.proficiency ?? []).filter((a: string): a is Ability => (ABILITIES as readonly string[]).includes(a))
    if (opts.cls.spellcastingAbility) s.casting = { ability: opts.cls.spellcastingAbility, progression: opts.cls.casterProgression ?? 'full' }
  }
  if (opts.background) {
    s.background = opts.background.name
    s.backgroundSource = opts.background.source
  }
  for (const k of [...backgroundSkills(opts.background), ...opts.skills]) s.skills[k] = 1
  const hp = Math.max(1, s.hitDie + mod(s.abilities.con))
  s.hp = { current: hp, max: hp, temp: 0 }
  s.ac = 10 + mod(s.abilities.dex)
  return s
}

/** One level up: average hit points for the class die, everything else follows from the level. */
export function levelUp(s: Sheet): Sheet {
  if (s.level >= 20) return s
  const gain = Math.max(1, Math.floor(s.hitDie / 2) + 1 + mod(s.abilities.con))
  const level = s.level + 1
  return {
    ...s,
    level,
    xp: Math.max(s.xp, XP_FOR_LEVEL[level - 1]),
    classLabel: s.class ? `${s.class} ${level}` : s.classLabel,
    hp: { ...s.hp, max: s.hp.max + gain, current: s.hp.current + gain },
  }
}

/** Fill in fields an older or hand-made sheet may lack. */
export function normalize(raw: Partial<Sheet> | null | undefined): Sheet {
  const base = emptySheet()
  const s = { ...base, ...(raw ?? {}) } as Sheet
  s.abilities = { ...base.abilities, ...(raw?.abilities ?? {}) }
  s.hp = { ...base.hp, ...(raw?.hp ?? {}) }
  s.deathSaves = { ...base.deathSaves, ...(raw?.deathSaves ?? {}) }
  s.currency = { ...base.currency, ...(raw?.currency ?? {}) }
  return s
}
