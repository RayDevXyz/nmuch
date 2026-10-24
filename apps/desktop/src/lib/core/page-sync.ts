import { schemaExtensions, ensureIds, newId } from '@brainwaves/editor'
import { getSchema, type JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { fromBase64, toBase64, type CoreClient } from './client'
import type { PageMeta } from '../types'

/** Transaction origin for changes that came from the core; those are never sent back. */
const FROM_CORE = 'core'

export const schema = getSchema(schemaExtensions())

export interface NoteRef {
  id: string
  order: string
  fragment: Y.XmlFragment
}

/**
 * A page's Y.Doc in the frontend, kept in sync with the core.
 *
 * - Load: the core sends the whole page once.
 * - Local edits: each Y.Doc update is queued, merged, and pushed to the core (the only writer).
 * - Changes from elsewhere: when the core reports a change to this page, ask it for exactly
 *   what we are missing (state-vector diff) and apply that.
 */
export class PageSync {
  readonly doc = new Y.Doc()
  readonly ready: Promise<void>
  private pending: Uint8Array[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushing: Promise<void> = Promise.resolve()
  private off: () => void
  private pulling = false
  private pullAgain = false

  constructor(
    readonly pageId: string,
    private core: CoreClient,
    private onSaving: (p: Promise<void>) => void,
    /** Resolves once the page exists in the core (it may still be being created). */
    exists: Promise<unknown> = Promise.resolve(),
  ) {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === FROM_CORE) return
      this.pending.push(update)
      clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.flush(), 120)
    })
    this.off = core.onEvent((e) => {
      if (e.type === 'pageChanged' && e.pageId === pageId) void this.pull()
    })
    this.ready = exists.then(() => core.call<string>('loadPage', { pageId })).then((b64) => {
      Y.applyUpdate(this.doc, fromBase64(b64), FROM_CORE)
    })
  }

  /** Send queued local edits now. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.pending.length) return this.flushing
    const update = Y.mergeUpdates(this.pending)
    this.pending = []
    const p = this.flushing.then(() => this.core.call<void>('pushUpdate', { pageId: this.pageId, update: toBase64(update) }))
    this.flushing = p.catch(() => {})
    this.onSaving(p)
    return p
  }

  private async pull() {
    if (this.pulling) {
      this.pullAgain = true
      return
    }
    this.pulling = true
    try {
      do {
        this.pullAgain = false
        const sv = toBase64(Y.encodeStateVector(this.doc))
        const b64 = await this.core.call<string>('pullUpdate', { pageId: this.pageId, stateVector: sv })
        Y.applyUpdate(this.doc, fromBase64(b64), FROM_CORE)
      } while (this.pullAgain)
    } finally {
      this.pulling = false
    }
  }

  title(): string {
    return String(this.doc.getMap('page').get('title') ?? '')
  }

  notes(): NoteRef[] {
    const out: NoteRef[] = []
    ;(this.doc.getMap('notes') as Y.Map<Y.Map<unknown>>).forEach((m, id) => {
      const fragment = m.get('content')
      if (fragment instanceof Y.XmlFragment) out.push({ id, order: String(m.get('order') ?? ''), fragment })
    })
    return out.sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1))
  }

  /** Each note as ProseMirror JSON. */
  notesJSON(): JSONContent[] {
    return this.notes().map((n) => yXmlFragmentToProseMirrorRootNode(n.fragment, schema).toJSON())
  }

  /** Replace the first note's content (seeding, duplicating). Missing block ids are filled in. */
  setContent(doc: JSONContent) {
    const first = this.notes()[0]
    if (!first) throw new Error('page has no note')
    prosemirrorJSONToYXmlFragment(schema, ensureIds(doc), first.fragment)
  }

  async destroy() {
    await this.flush().catch(() => {})
    this.off()
    this.doc.destroy()
  }
}

/**
 * A complete page as one Yjs update, in the layout the core expects (schema 2, see
 * `crates/bw-core/src/schema.rs`): page metadata plus one note holding `content`.
 * Used by importers with `importPage`; the core validates it before writing anything.
 */
export function buildPageUpdate(pageId: string, meta: PageMeta, content: JSONContent): Uint8Array {
  const doc = new Y.Doc()
  const fragment = new Y.XmlFragment()
  doc.transact(() => {
    const page = doc.getMap('page')
    page.set('id', pageId)
    page.set('schema', 2)
    page.set('title', meta.title)
    page.set('icon', meta.icon)
    page.set('parent', meta.parentId)
    page.set('key', meta.key)
    page.set('favorite', meta.favorite)
    page.set('archived', meta.archived)
    page.set('trashedAt', meta.trashedAt)
    const note = new Y.Map<unknown>()
    const noteId = newId()
    doc.getMap('notes').set(noteId, note)
    note.set('id', noteId)
    note.set('order', 'a0')
    note.set('xywh', null)
    note.set('content', fragment)
  })
  prosemirrorJSONToYXmlFragment(schema, ensureIds(content), fragment)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

// ---- shared instances: one PageSync per open page, reference counted

const open = new Map<string, { sync: PageSync; refs: number }>()

export function acquirePage(
  pageId: string,
  core: CoreClient,
  onSaving: (p: Promise<void>) => void,
  exists?: Promise<unknown>,
): PageSync {
  const hit = open.get(pageId)
  if (hit) {
    hit.refs++
    return hit.sync
  }
  const sync = new PageSync(pageId, core, onSaving, exists)
  open.set(pageId, { sync, refs: 1 })
  return sync
}

export function releasePage(pageId: string) {
  const hit = open.get(pageId)
  if (!hit || --hit.refs > 0) return
  open.delete(pageId)
  void hit.sync.destroy()
}

/** Push every open page's queued edits (before closing a tab or the window). */
export function flushAll(): Promise<unknown> {
  return Promise.all([...open.values()].map((o) => o.sync.flush().catch(() => {})))
}
