import { coreClient } from '../lib/storage'

/**
 * Azgaar's Fantasy Map Generator (https://azgaar.github.io/Fantasy-Map-Generator/) exports a JSON
 * file with the whole world. Most of it is terrain cells; this keeps what a campaign needs
 * (states, cities, landmark markers with their notes, religions) in the shape the core imports
 * (`crates/bw-core/src/azgaar.rs`). Generator versions differ a little, so everything is read
 * defensively.
 */

export const AZGAAR_URL = 'https://azgaar.github.io/Fantasy-Map-Generator/'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>

export interface Place {
  key: string
  title: string
  kind: 'region' | 'city' | 'village' | 'landmark'
  x?: number
  y?: number
  region?: string
  text: string[]
  color?: string
}

export interface World {
  name: string
  width: number
  height: number
  image?: string
  regions: Place[]
  places: Place[]
  factions: { key: string; title: string; goal: string; text: string[] }[]
}

export interface Parsed {
  name: string
  width: number
  height: number
  states: Place[]
  burgs: (Place & { population: number; capital: boolean; port: boolean })[]
  markers: Place[]
  religions: World['factions']
}

export type CityChoice = 'all' | 'major' | 'capitals' | 'none'

const live = <T extends Raw>(list: unknown): T[] => (Array.isArray(list) ? (list as T[]).filter((x) => x && typeof x === 'object' && !x.removed && x.i !== 0 && x.name) : [])

/** Plain text from a marker note's HTML legend, one line per paragraph. */
function htmlLines(html: string): string[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n'), 'text/html')
  return (doc.body.textContent ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function parseAzgaar(text: string): Parsed {
  let data: Raw
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That isn't a JSON file. In the generator, use Export → JSON (full or minimal), not the .map save file.")
  }
  const pack: Raw = data.pack ?? {}
  if (!pack.burgs && !pack.states) throw new Error("This JSON has no states or cities: export it from the generator with Export → JSON.")
  const info: Raw = data.info ?? {}
  const settings: Raw = data.settings ?? {}
  const width = Number(info.width ?? settings.mapWidth ?? data.mapCoordinates?.width ?? 0) || guessSize(pack.burgs, 'x')
  const height = Number(info.height ?? settings.mapHeight ?? data.mapCoordinates?.height ?? 0) || guessSize(pack.burgs, 'y')
  const popRate = Number(settings.populationRate ?? 1000) || 1000
  const urban = Number(settings.urbanization ?? 1) || 1

  const cultures = new Map<number, string>(live(pack.cultures).map((c) => [c.i, c.name]))
  const provinces = new Map<number, Raw>(live(pack.provinces).map((p) => [p.i, p]))
  const burgList = live(pack.burgs)
  const burgName = new Map<number, string>(burgList.map((b) => [b.i, b.name]))
  const religions = new Map<number, Raw>(live(pack.religions).map((r) => [r.i, r]))

  const states: Place[] = live(pack.states).map((s) => {
    const settlements = burgList.filter((b) => b.state === s.i).length
    return {
      key: `state:${s.i}`,
      title: s.fullName || s.name,
      kind: 'region',
      text: [
        [s.formName || s.form, s.type ? `(${String(s.type).toLowerCase()})` : ''].filter(Boolean).join(' '),
        s.capital && burgName.get(s.capital) ? `Capital: ${burgName.get(s.capital)}` : '',
        settlements ? `${settlements} settlements` : '',
        cultures.get(s.culture) ? `Culture: ${cultures.get(s.culture)}` : '',
      ].filter(Boolean),
    }
  })
  const stateTitle = new Map(states.map((s) => [s.key, s.title]))

  const burgs = burgList.map((b) => {
    const population = Math.round(Number(b.population ?? 0) * popRate * urban)
    const capital = !!b.capital
    const port = !!b.port
    const province = provinces.get(b.province ?? cellField(pack.cells, b.cell, 'province') ?? -1)?.name ?? [...provinces.values()].find((p) => p.burg === b.i)?.name
    const religionId = cellField(pack.cells, b.cell, 'religion')
    const religion = religionId ? religions.get(religionId)?.name : undefined
    // Newer versions group settlements (capital, city, town, village, hamlet, fort…).
    const group = String(b.group ?? '')
    const kind: Place['kind'] =
      group === 'fort' ? 'landmark' : capital || group === 'city' || (group !== 'village' && group !== 'hamlet' && population >= 5000) ? 'city' : 'village'
    const features = [b.walls && 'city walls', b.citadel && 'a citadel', b.temple && 'a temple', b.plaza && 'a market square', b.shanty && 'a shanty town'].filter(Boolean)
    const region = b.state ? `state:${b.state}` : undefined
    return {
      key: `burg:${b.i}`,
      title: b.name,
      kind,
      x: Number(b.x),
      y: Number(b.y),
      region,
      population,
      capital,
      port,
      color: capital ? 'yellow' : kind === 'city' ? 'red' : kind === 'landmark' ? 'gray' : 'brown',
      text: [
        capital && region ? `Capital of ${stateTitle.get(region) ?? 'its realm'}.` : '',
        population ? `Population: about ${population.toLocaleString()}.` : '',
        [group === 'fort' ? 'A fort' : group && group !== 'capital' ? `A ${group}` : '', port ? 'a port' : '', b.type && b.type !== 'Generic' ? `${String(b.type).toLowerCase()} settlement` : '']
          .filter(Boolean)
          .join(', ')
          .replace(/^a /, 'A '),
        province ? `Province: ${province}` : '',
        cultures.get(b.culture) ? `Culture: ${cultures.get(b.culture)}` : '',
        religion ? `Religion: ${religion}` : '',
        features.length ? `Has ${features.join(', ')}.` : '',
      ].filter(Boolean),
    }
  })

  const notes = new Map<string, Raw>((Array.isArray(data.notes) ? data.notes : []).map((n: Raw) => [String(n.id), n]))
  const markers: Place[] = (Array.isArray(pack.markers) ? pack.markers : [])
    .filter((m: Raw) => m && typeof m.x === 'number' && typeof m.y === 'number')
    .map((m: Raw) => {
      // Newer versions keep the name and note on the marker; older ones in `notes` ("marker<i>").
      const note = notes.get(`marker${m.i}`)
      const type = String(m.type ?? 'landmark').replace(/-/g, ' ')
      return {
        key: `marker:${m.i}`,
        title: m.name || note?.name || `${type[0].toUpperCase()}${type.slice(1)}`,
        kind: 'landmark' as const,
        x: m.x,
        y: m.y,
        color: 'purple',
        text: [type ? `Landmark: ${type}` : '', ...htmlLines(String(m.note ?? note?.legend ?? ''))].filter(Boolean),
      }
    })

  const religionFactions = [...religions.values()].map((r) => ({
    key: `religion:${r.i}`,
    title: r.name,
    goal: [r.form, r.type].filter(Boolean).join(' · ') || 'Religion',
    text: [r.deity ? `Deity: ${r.deity}` : '', r.expansion ? `Spreads ${String(r.expansion)}ly` : ''].filter(Boolean),
  }))

  return { name: String(info.mapName ?? data.mapName ?? 'World'), width, height, states, burgs, markers, religions: religionFactions }
}

/** A field of one terrain cell: cells are a list of objects in newer versions, columns in older. */
function cellField(cells: unknown, cell: unknown, field: string): number | undefined {
  if (typeof cell !== 'number' || !cells) return undefined
  if (Array.isArray(cells)) {
    const v = (cells[cell] as Raw | undefined)?.[field]
    return typeof v === 'number' ? v : undefined
  }
  const col = (cells as Raw)[field]
  const v = col && typeof col === 'object' ? col[cell] : undefined
  return typeof v === 'number' ? v : undefined
}

function guessSize(burgs: unknown, k: 'x' | 'y'): number {
  const xs = (Array.isArray(burgs) ? burgs : []).map((b: Raw) => Number(b?.[k] ?? 0)).filter(Number.isFinite)
  return xs.length ? Math.ceil(Math.max(...xs) * 1.05) : 0
}

/** Which cities to bring in: all, the major ones (capitals, ports, the 60 largest), capitals. */
export function chooseCities(burgs: Parsed['burgs'], choice: CityChoice): Parsed['burgs'] {
  if (choice === 'none') return []
  if (choice === 'all') return burgs
  if (choice === 'capitals') return burgs.filter((b) => b.capital)
  const largest = new Set([...burgs].sort((a, b) => b.population - a.population).slice(0, 60).map((b) => b.key))
  return burgs.filter((b) => b.capital || b.port || largest.has(b.key))
}

export interface Report {
  created: number
  updated: number
  pins: number
  removedPins: number
  factions: number
  map: string
}

/** Generated text can hold half an emoji (a lone UTF-16 surrogate), which isn't valid JSON for the core. */
const wellFormed = (t: string) => t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')

function clean<T>(v: T): T {
  if (typeof v === 'string') return wellFormed(v) as T
  if (Array.isArray(v)) return v.map(clean) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) as T
  return v
}

export const importWorld = (campaignId: string, world: World) =>
  coreClient().call<Report>('dndImportAzgaar', { id: campaignId, world: { ...clean({ ...world, image: undefined }), image: world.image } })
