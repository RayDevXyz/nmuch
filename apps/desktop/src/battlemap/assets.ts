import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { withPage } from '../state/actions'
import { builtinById, builtinSrc } from './props'

/**
 * Your own props: pictures and videos dropped on a battle map (PNG, SVG, GIF, APNG, animated
 * WebP, WebM). Each is kept in the map's page (so the map is whole on its own and can go to the
 * table), and in the campaign's page, which is the library every map of the campaign shows.
 */

export interface Asset {
  hash: string
  name: string
  mime: string
  /** A data URL: the file as it was (animations kept), or shrunk if it was a big still picture. */
  src: string
  w: number
  h: number
  animated: boolean
  video: boolean
  tags: string[]
  at: number
}

const MAP = 'mapAssets'
export const MAX_ASSET = 8 << 20
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/apng,video/webm,video/mp4'

const assetsOf = (doc: Y.Doc) => doc.getMap(MAP) as Y.Map<Asset>

export function readAssets(doc: Y.Doc): Record<string, Asset> {
  const out: Record<string, Asset> = {}
  assetsOf(doc).forEach((a, k) => {
    if (a && typeof a === 'object' && typeof a.src === 'string') out[k] = a
  })
  return out
}

/** The map's own assets, kept up to date. */
export function useAssets(doc: Y.Doc | null): Record<string, Asset> {
  const [a, setA] = useState<Record<string, Asset>>(() => (doc ? readAssets(doc) : {}))
  useEffect(() => {
    if (!doc) return
    const m = assetsOf(doc)
    const f = () => setA(readAssets(doc))
    f()
    m.observe(f)
    return () => m.unobserve(f)
  }, [doc])
  return a
}

/** A prop's picture: a built-in's drawing, or an upload's file. */
export function propSrc(asset: string, assets: Record<string, Asset>): { src: string; video: boolean; animated: boolean } | null {
  if (asset.startsWith('b:')) {
    const id = asset.slice(2)
    return builtinById.has(id) ? { src: builtinSrc(id), video: false, animated: false } : null
  }
  const a = assets[asset.slice(2)]
  return a ? { src: a.src, video: a.video, animated: a.animated } : null
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

const readAs = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('the file could not be read'))
    r.readAsDataURL(f)
  })

/** Whether a picture's bytes say it moves: a GIF with a loop, an APNG, an animated WebP. */
async function moves(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 1 << 20)).arrayBuffer())
  const text = new TextDecoder('latin1').decode(head)
  if (file.type === 'image/gif') return text.includes('NETSCAPE2.0') || (text.match(/\x00\x21\xF9\x04/g) ?? []).length > 1
  if (file.type === 'image/png' || file.type === 'image/apng') return text.includes('acTL')
  if (file.type === 'image/webp') return text.includes('ANIM')
  return false
}

function sizeOf(src: string, video: boolean): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    if (video) {
      const v = document.createElement('video')
      v.onloadedmetadata = () => res({ w: v.videoWidth || 100, h: v.videoHeight || 100 })
      v.onerror = () => res({ w: 100, h: 100 })
      v.src = src
      return
    }
    const i = new Image()
    i.onload = () => res({ w: i.naturalWidth || 100, h: i.naturalHeight || 100 })
    i.onerror = () => res({ w: 100, h: 100 })
    i.src = src
  })
}

/** Shrink a big still picture (a prop needs no more than 1024 pixels a side). */
async function shrink(src: string, w: number, h: number): Promise<{ src: string; w: number; h: number }> {
  const max = 1024
  if (Math.max(w, h) <= max) return { src, w, h }
  const s = max / Math.max(w, h)
  const img = new Image()
  await new Promise((r) => ((img.onload = r), (img.onerror = r), (img.src = src)))
  const c = document.createElement('canvas')
  c.width = Math.round(w * s)
  c.height = Math.round(h * s)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return { src: c.toDataURL('image/png'), w: c.width, h: c.height }
}

/** Read a dropped or chosen file into an asset. */
export async function readAsset(file: File): Promise<Asset> {
  const video = file.type.startsWith('video/')
  if (!video && !file.type.startsWith('image/')) throw new Error(`${file.name} is not a picture or a video`)
  if (file.size > MAX_ASSET) throw new Error(`${file.name} is larger than ${MAX_ASSET >> 20} MB`)
  const animated = video || (await moves(file))
  let src = await readAs(file)
  let { w, h } = await sizeOf(src, video)
  if (!animated && file.type !== 'image/svg+xml') ({ src, w, h } = await shrink(src, w, h))
  const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'Prop'
  return { hash: await sha(src), name, mime: file.type, src, w, h, animated, video, tags: name.toLowerCase().split(/\s+/), at: Date.now() }
}

/** Keep an asset in a doc. */
export function putAsset(doc: Y.Doc, a: Asset) {
  if (!assetsOf(doc).has(a.hash)) assetsOf(doc).set(a.hash, a)
}

/** The campaign's library (every upload on any of its maps). */
export async function libraryOf(campaignId: string | null): Promise<Record<string, Asset>> {
  if (!campaignId) return {}
  try {
    return await withPage(campaignId, (s) => readAssets(s.doc))
  } catch {
    return {}
  }
}

/** Add an upload to the map and the campaign's library. */
export async function addToLibrary(campaignId: string | null, sceneDoc: Y.Doc, a: Asset) {
  putAsset(sceneDoc, a)
  if (!campaignId) return
  await withPage(campaignId, (s) => {
    putAsset(s.doc, a)
    return s.flush()
  }).catch(() => {})
}

export async function removeFromLibrary(campaignId: string | null, hash: string) {
  if (!campaignId) return
  await withPage(campaignId, (s) => {
    assetsOf(s.doc).delete(hash)
    return s.flush()
  }).catch(() => {})
}
