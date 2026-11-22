import { schemaExtensions } from '@brainwaves/editor'
import { getSchema, type Editor as TiptapEditor, type JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { addNote, CANVAS, type CanvasNote, type XYWH } from './model'

/**
 * Splitting a page's note into parts on the canvas, and merging parts back. Every part is a
 * note of the same page: in the document they read in order; on the canvas each moves on its
 * own.
 */
const schema = getSchema(schemaExtensions())
const GAP = 48

const fragmentOf = (doc: Y.Doc, noteId: string) => (doc.getMap('notes').get(noteId) as Y.Map<unknown> | undefined)?.get('content') as Y.XmlFragment | undefined

const noIds = (ns: JSONContent[]): JSONContent[] =>
  ns.map((n) => ({ ...n, ...(n.attrs && 'id' in n.attrs ? { attrs: { ...n.attrs, id: null } } : {}), ...(n.content ? { content: noIds(n.content) } : {}) }))

/** A new note holding `blocks`, placed at `xywh`, right after `after` in the document. */
function noteWith(doc: Y.Doc, blocks: JSONContent[], xywh: XYWH, display: CanvasNote['display'], after: string): string {
  const id = addNote(doc, xywh, display, after)
  const f = fragmentOf(doc, id)
  if (f) doc.transact(() => prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: noIds(blocks) }, f), CANVAS)
  return id
}

/** Top-level blocks of a note's editor and where each starts. */
function blocksOf(editor: TiptapEditor) {
  const out: { pos: number; json: JSONContent; heading: number }[] = []
  editor.state.doc.forEach((n, pos) => out.push({ pos, json: n.toJSON() as JSONContent, heading: n.type.name === 'heading' ? Number(n.attrs.level) : 0 }))
  return out
}

/**
 * Split at the cursor: the block it's in and everything after it go to a new note to the right.
 * Returns the new note's id, or a reason it can't.
 */
export function splitAtCursor(doc: Y.Doc, note: CanvasNote, editor: TiptapEditor): string | { error: string } {
  const blocks = blocksOf(editor)
  const i = editor.state.selection.$from.index(0)
  if (blocks.length < 2) return { error: 'This note has only one block: nothing to split' }
  if (i === 0) return { error: 'Put the cursor in the block where the second part should start' }
  const moving = blocks.slice(i).map((b) => b.json)
  const [x, y, w, h] = note.xywh ?? [0, 0, 640, 0]
  const id = noteWith(doc, moving, [x + w + GAP, y, w, h], note.display, note.id)
  editor.chain().deleteRange({ from: blocks[i].pos, to: editor.state.doc.content.size }).run()
  return id
}

/**
 * Split into sections: a new note at each heading of the highest level the note uses (what
 * comes before the first heading stays). The parts are laid out in a row to the right.
 */
export function splitByHeadings(doc: Y.Doc, note: CanvasNote, editor: TiptapEditor): string[] | { error: string } {
  const blocks = blocksOf(editor)
  const levels = blocks.filter((b) => b.heading).map((b) => b.heading)
  if (!levels.length) return { error: 'This note has no headings to split at' }
  const top = Math.min(...levels)
  const starts = blocks.map((b, i) => (b.heading === top && i > 0 ? i : -1)).filter((i) => i > 0)
  if (!starts.length) return { error: 'Only one section: nothing to split' }
  const [x, y, w, h] = note.xywh ?? [0, 0, 640, 0]
  const made: string[] = []
  let after = note.id
  starts.forEach((s, k) => {
    const end = starts[k + 1] ?? blocks.length
    const id = noteWith(doc, blocks.slice(s, end).map((b) => b.json), [x + (k + 1) * (w + GAP), y, w, h], note.display, after)
    made.push(id)
    after = id
  })
  editor.chain().deleteRange({ from: blocks[starts[0]].pos, to: editor.state.doc.content.size }).run()
  return made
}

/**
 * Merge notes into one: the top-left one keeps its place and gets the others' content after its
 * own, in reading order (top to bottom, then left to right). Returns which to keep and which
 * to remove.
 */
export function mergeNotes(doc: Y.Doc, notes: CanvasNote[], editors: Map<string, TiptapEditor>): { keep: string; remove: string[] } | { error: string } {
  if (notes.length < 2) return { error: 'Select two or more notes to merge' }
  const sorted = [...notes].sort((a, b) => {
    const [ax, ay] = a.xywh ?? [0, 0]
    const [bx, by] = b.xywh ?? [0, 0]
    return Math.abs(ay - by) > 40 ? ay - by : ax - bx
  })
  const [keep, ...rest] = sorted
  const target = editors.get(keep.id)
  if (!target) return { error: 'Could not open the first note' }
  const content: JSONContent[] = []
  for (const n of rest) {
    const ed = editors.get(n.id)
    const json = ed ? (ed.getJSON() as JSONContent) : (() => {
      const f = fragmentOf(doc, n.id)
      return f ? (yXmlFragmentToProseMirrorRootNode(f, schema).toJSON() as JSONContent) : { content: [] }
    })()
    content.push(...(json.content ?? []).filter((b) => !(b.type === 'paragraph' && !b.content?.length)))
  }
  target.chain().insertContentAt(target.state.doc.content.size, noIds(content)).run()
  // The caller removes the others once their editors are gone (see Canvas).
  return { keep: keep.id, remove: rest.map((n) => n.id) }
}
