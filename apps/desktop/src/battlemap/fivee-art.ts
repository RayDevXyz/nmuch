import { coreClient } from '../lib/storage'
import { enabledSources, entries, fetchData, type Entry, type Raw } from '../dnd/fivee'

/**
 * Pictures from the user's 5etools (its `img/` folder): monster tokens, creature and item art,
 * and the maps in its adventures and books, with their grids. Which pictures exist is read from
 * 5etools' own data (`hasToken`, fluff images, map entries), so nothing is guessed.
 */

export type PicKind = 'token' | 'creature' | 'item' | 'map'

export interface Pic {
  key: string
  kind: PicKind
  name: string
  source: string
  /** Inside `img/`. */
  path: string
  /** The monster it belongs to (tokens). */
  entry?: Entry
  map?: MapInfo
}

/** A map in an adventure or book, with its grid (5etools' own numbers, in the picture's pixels). */
export interface MapInfo {
  title: string
  book: string
  width?: number
  height?: number
  /** The players' version of a DM map. */
  player: boolean
  grid?: { type: string; size: number; offsetX?: number; offsetY?: number; distance?: number; units?: string }
}

export const fiveeImage = (path: string) => coreClient().call<string>('fiveeImage', { path })
export const getImageSource = () => coreClient().call<string | null>('dndImageSource')
export const setImageSource = (url: string) => coreClient().call<string | null>('dndSetImageSource', { url })

/** Thumbnails and pictures, kept for the session. */
const pics = new Map<string, Promise<string>>()
export function picture(path: string): Promise<string> {
  let p = pics.get(path)
  if (!p) {
    p = fiveeImage(path)
    p.catch(() => pics.delete(path))
    pics.set(path, p)
  }
  return p
}

/** 5etools' own rule for a token's file name. */
const tokenName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .replace(/"/g, '')

/** A monster's token picture inside `img/` (null: it has none). */
export function tokenPath(raw: Raw): string | null {
  if (raw.token?.name && raw.token?.source) return `bestiary/tokens/${raw.token.source}/${tokenName(raw.token.name)}.webp`
  if (raw.hasToken && raw.name && raw.source) return `bestiary/tokens/${raw.source}/${tokenName(raw.name)}.webp`
  return null
}

const optional = async (path: string): Promise<Raw> => {
  try {
    return (await fetchData(path)) as Raw
  } catch {
    return {}
  }
}

const internal = (img: Raw): string | null => (img?.href?.type === 'internal' && typeof img.href.path === 'string' ? img.href.path : null)

const memo = new Map<string, Promise<Pic[]>>()
const once = (key: string, f: () => Promise<Pic[]>) => {
  let p = memo.get(key)
  if (!p) {
    p = f()
    p.catch(() => memo.delete(key))
    memo.set(key, p)
  }
  return p
}

/** Monsters that have a token, from the books turned on. */
export const tokens = () =>
  once('token', async () =>
    (await entries('monster'))
      .map((e) => ({ e, path: tokenPath(e.raw) }))
      .filter((x): x is { e: Entry; path: string } => !!x.path)
      .map(({ e, path }) => ({ key: `t|${e.name}|${e.source}`, kind: 'token' as const, name: e.name, source: e.source, path, entry: e })),
  )

/** Pictures from fluff files (creature or item art). */
async function fluffPics(files: string[], key: string, kind: 'creature' | 'item'): Promise<Pic[]> {
  const on = await enabledSources()
  const parts = await Promise.all(files.map(optional))
  const out: Pic[] = []
  const seen = new Set<string>()
  for (const part of parts)
    for (const f of (part[key] ?? []) as Raw[]) {
      if (on && !on.has(String(f.source).toUpperCase())) continue
      for (const img of (f.images ?? []) as Raw[]) {
        const path = internal(img)
        if (!path || seen.has(path)) continue
        seen.add(path)
        out.push({ key: `${kind}|${path}`, kind, name: String(f.name), source: String(f.source), path })
      }
    }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const creatureArt = () =>
  once('creature', async () => {
    const index = (await optional('data/bestiary/fluff-index.json')) as Record<string, string>
    return fluffPics([...new Set(Object.values(index))].map((f) => `data/bestiary/${f}`), 'monsterFluff', 'creature')
  })

export const itemArt = () => once('item', () => fluffPics(['data/fluff-items.json'], 'itemFluff', 'item'))

export interface MapBook {
  id: string
  name: string
  file: string
}

/** Adventures and books (the ones turned on) that may hold maps. */
export async function mapBooks(): Promise<MapBook[]> {
  const on = await enabledSources()
  const [advs, books] = await Promise.all([optional('data/adventures.json'), optional('data/books.json')])
  const out: MapBook[] = []
  for (const a of (advs.adventure ?? []) as Raw[]) if (a.id) out.push({ id: String(a.id), name: String(a.name), file: `data/adventure/adventure-${String(a.id).toLowerCase()}.json` })
  for (const b of (books.book ?? []) as Raw[]) if (b.id) out.push({ id: String(b.id), name: String(b.name), file: `data/book/book-${String(b.id).toLowerCase()}.json` })
  return out.filter((b) => !on || on.has(b.id.toUpperCase()))
}

/** The maps in one adventure or book. */
export const mapsIn = (book: MapBook) =>
  once(`map|${book.id}`, async () => {
    const data = await optional(book.file)
    const out: Pic[] = []
    const walk = (x: unknown) => {
      if (Array.isArray(x)) return x.forEach(walk)
      if (!x || typeof x !== 'object') return
      const o = x as Raw
      if (o.type === 'image' && (o.imageType === 'map' || o.imageType === 'mapPlayer')) {
        const path = internal(o)
        if (path)
          out.push({
            key: `map|${path}`,
            kind: 'map',
            name: String(o.title ?? 'Map'),
            source: book.id,
            path,
            map: { title: String(o.title ?? 'Map'), book: book.name, width: o.width, height: o.height, player: o.imageType === 'mapPlayer', grid: o.grid?.size ? o.grid : undefined },
          })
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v)
    }
    walk(data.data)
    return out
  })

/** A data URL as a File (to keep it as an asset). */
export async function asFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  const ext = blob.type.split('/')[1]?.replace('svg+xml', 'svg') || 'webp'
  return new File([blob], `${name}.${ext}`, { type: blob.type })
}
