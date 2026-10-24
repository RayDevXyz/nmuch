import { blocksToDoc } from './convert'
import { buildPageUpdate } from './core/page-sync'
import { toBase64 } from './core/client'
import { coreClient, db, metaOf } from './storage'
import type { BlockProps, BlockType, Page } from './types'

/**
 * Import notes from the old Nimbus app.
 *
 * The Rust side only *reads* `nimbus.db` (read-only, never modified). Each page is converted
 * here with the same converter the sample pages use, built into a complete page Y.Doc, and
 * handed to the core as one update (`importPage`), keeping its id, place in the tree,
 * favorite/archived/trash state and its original created/updated dates.
 *
 * Page ids are kept, so links between imported pages keep working. Pages that already exist
 * are skipped, so running the import twice is harmless.
 */

interface NimbusBlock {
  id: string
  type: BlockType
  text: string
  props: BlockProps
  key: string
}

export interface ImportProgress {
  done: number
  total: number
  title: string
}

export interface ImportResult {
  imported: number
  skipped: number
  failed: { title: string; error: string }[]
}

/** The `nimbus.db` next to the app's data folder, if there is one. */
export function nimbusDefaultPath(): Promise<string | null> {
  return coreClient().call<string | null>('nimbusDefaultPath')
}

export async function importNimbus(path: string, onProgress?: (p: ImportProgress) => void): Promise<ImportResult> {
  const core = coreClient()
  const pages = await core.call<Page[]>('nimbusPages', { path })
  const existing = new Set((await db().listPages()).map((p) => p.id))
  const result: ImportResult = { imported: 0, skipped: 0, failed: [] }

  for (const [i, page] of pages.entries()) {
    onProgress?.({ done: i, total: pages.length, title: page.title || 'Untitled' })
    if (existing.has(page.id)) {
      result.skipped++
      continue
    }
    try {
      const blocks = await core.call<NimbusBlock[]>('nimbusBlocks', { path, pageId: page.id })
      const doc = blocksToDoc(blocks.map((b) => ({ id: b.id, type: b.type, text: b.text, props: b.props ?? {} })))
      const update = buildPageUpdate(page.id, metaOf(page), doc)
      await core.call('importPage', {
        id: page.id,
        update: toBase64(update),
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      })
      result.imported++
    } catch (e) {
      result.failed.push({ title: page.title || 'Untitled', error: String(e) })
    }
  }
  onProgress?.({ done: pages.length, total: pages.length, title: '' })
  return result
}

export function describeImport(r: ImportResult): string {
  const parts = [`Imported ${r.imported} page${r.imported === 1 ? '' : 's'} from Nimbus`]
  if (r.skipped) parts.push(`${r.skipped} already here`)
  if (r.failed.length) parts.push(`${r.failed.length} failed`)
  return parts.join(' · ')
}
