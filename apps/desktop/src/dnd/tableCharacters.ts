import { queryDatabase } from '../database/api'
import { createCharacter, dndWorkspace, getSheet, refreshRoles } from './api'
import { entries, find, SIZE, type Entry } from './fivee'
import type { CharacterRules, Submission } from './live'
import { backgroundSkills, buildSheet, classSkillChoice, levelUp, POINT_COST, racialBonuses, STANDARD_ARRAY, type Sheet } from './rules'

/**
 * Characters built on the table site: the options players choose from (from the DM's 5etools,
 * limited by the campaign's rules), the checks the DM sees before approving, and turning an
 * approved submission into a character with the same rules as the "New character" wizard.
 */

export interface RaceOption {
  name: string
  source: string
  bonus: Record<string, number>
  size?: string
  speed?: number
}
export interface ClassOption {
  name: string
  source: string
  hd: number
  skills: { from: string[]; count: number }
  saves: string[]
  caster: boolean
}
export interface BackgroundOption {
  name: string
  source: string
  skills: string[]
}
export interface RuleOptions {
  races: RaceOption[]
  classes: ClassOption[]
  backgrounds: BackgroundOption[]
}

const allowed = (rules: CharacterRules) => (e: Entry) => !rules.sources || rules.sources.map((s) => s.toLowerCase()).includes(e.source.toLowerCase())
const list = async (cat: 'race' | 'class' | 'background') => entries(cat).catch(() => [] as Entry[])

/** Every source the compendium has races, classes or backgrounds from, with how many. */
export async function characterSources(): Promise<{ source: string; count: number }[]> {
  const counts = new Map<string, number>()
  for (const cat of ['race', 'class', 'background'] as const) for (const e of await list(cat)) counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
  return [...counts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count)
}

/** What players may choose from, under the campaign's rules. */
export async function ruleOptions(rules: CharacterRules): Promise<RuleOptions> {
  const ok = allowed(rules)
  const [races, classes, backgrounds] = await Promise.all([list('race'), list('class'), list('background')])
  return {
    races: races.filter(ok).map((e) => {
      const size = Array.isArray(e.raw.size) ? e.raw.size[0] : e.raw.size
      const speed = typeof e.raw.speed === 'number' ? e.raw.speed : e.raw.speed?.walk
      return { name: e.name, source: e.source, bonus: racialBonuses(e.raw) as Record<string, number>, size: SIZE[size] ?? undefined, speed }
    }),
    classes: classes.filter(ok).map((e) => ({
      name: e.name,
      source: e.source,
      hd: e.raw.hd?.faces ?? 8,
      skills: classSkillChoice(e.raw),
      saves: e.raw.proficiency ?? [],
      caster: !!e.raw.spellcastingAbility,
    })),
    backgrounds: backgrounds.filter(ok).map((e) => ({ name: e.name, source: e.source, skills: backgroundSkills(e.raw) })),
  }
}

/** The campaign's characters with their sheets, as players see them. */
export async function loadParty(campaignId: string) {
  const w = await dndWorkspace()
  const { rows } = await queryDatabase(w.characters)
  const party = rows.filter((r) => Array.isArray(r.values[w.characterCampaign]) && (r.values[w.characterCampaign] as string[]).includes(campaignId))
  return Promise.all(
    party.map(async (r) => {
      const sheet = await getSheet(r.id).catch(() => null)
      return { id: r.id, name: r.title || 'Unnamed hero', player: sheet?.player ?? null, sheet }
    }),
  )
}

/** What the DM should know before approving: anything outside the rules. Empty: all fine. */
export async function checkSubmission(sub: Submission, rules: CharacterRules): Promise<string[]> {
  const c = sub.character
  const out: string[] = []
  const opts = await ruleOptions(rules)
  const has = (l: { name: string; source: string }[], o: { name: string; source: string } | null) => !!o && l.some((x) => x.name === o.name && x.source === o.source)
  if (c.race && !has(opts.races, c.race)) out.push(`${c.race.name} (${c.race.source}) isn't among the races you allow.`)
  if (!c.class) out.push('No class chosen.')
  else if (!has(opts.classes, c.class)) out.push(`${c.class.name} (${c.class.source}) isn't among the classes you allow.`)
  if (c.background && !has(opts.backgrounds, c.background)) out.push(`${c.background.name} (${c.background.source}) isn't among the backgrounds you allow.`)
  const scores = ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => Number(c.base?.[a]))
  if (rules.method !== 'any' && c.method !== rules.method) out.push(`Scores were made by ${c.method}, not ${rules.method}.`)
  if (scores.some((n) => !Number.isFinite(n))) out.push('Ability scores are missing.')
  else if (c.method === 'standard' && [...scores].sort((a, b) => b - a).join() !== [...STANDARD_ARRAY].sort((a, b) => b - a).join()) out.push(`Scores ${scores.join(', ')} aren't the standard array.`)
  else if (c.method === 'pointbuy') {
    const cost = scores.reduce((n, s) => n + (POINT_COST[s] ?? 99), 0)
    if (cost > 27) out.push(`Point buy costs ${cost > 900 ? 'more than allowed (a score outside 8–15)' : cost} of 27 points.`)
  } else if (scores.some((n) => n < 3 || n > 18)) out.push(`Scores ${scores.join(', ')} go outside 3–18 before racial bonuses.`)
  const cls = c.class && opts.classes.find((x) => x.name === c.class!.name && x.source === c.class!.source)
  if (cls) {
    const off = c.skills.filter((k) => !cls.skills.from.includes(k))
    if (off.length) out.push(`Skills not offered by the class: ${off.join(', ')}.`)
    if (c.skills.length > cls.skills.count) out.push(`${c.skills.length} class skills chosen; the class gives ${cls.skills.count}.`)
  }
  return out
}

/** The sheet an approved submission becomes (the wizard's rules, at the campaign's level). */
export async function sheetFor(sub: Submission, rules: CharacterRules): Promise<Sheet> {
  const c = sub.character
  const get = async (cat: 'race' | 'class' | 'background', o: { name: string; source: string } | null) => (o ? ((await find({ cat, name: o.name, source: o.source }).catch(() => null))?.raw ?? null) : null)
  const [race, cls, background] = await Promise.all([get('race', c.race), get('class', c.class), get('background', c.background)])
  const base = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => [a, Math.max(1, Math.min(30, Number(c.base?.[a]) || 10))])) as Sheet['abilities']
  let sheet = buildSheet({ player: sub.player, race, cls, background, base, skills: c.skills ?? [] })
  for (let l = 1; l < Math.max(1, Math.min(20, rules.level || 1)); l++) sheet = levelUp(sheet)
  if (c.alignment) sheet.alignment = c.alignment
  if (c.backstory) sheet.backstory = c.backstory.slice(0, 4000)
  return sheet
}

/** Make the character in the campaign; returns its page id. */
export async function approve(sub: Submission, rules: CharacterRules, campaignId: string): Promise<string> {
  const sheet = await sheetFor(sub, rules)
  const id = await createCharacter(sub.character.name.trim().slice(0, 80) || 'Unnamed hero', sheet, campaignId)
  await refreshRoles()
  return id
}
