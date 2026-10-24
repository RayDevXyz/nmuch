import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { BLOCK_TYPES } from './schema'

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)

const isBlock = (n: PMNode) => (BLOCK_TYPES as readonly string[]).includes(n.type.name)

/** Remove ids from pasted content so blocks copied from another page get fresh ones. */
function stripIds(fragment: Fragment): Fragment {
  const out: PMNode[] = []
  fragment.forEach((n) => {
    const attrs = isBlock(n) && n.attrs.id ? { ...n.attrs, id: null } : n.attrs
    out.push(n.isText ? n : n.type.create(attrs, stripIds(n.content), n.marks))
  })
  return Fragment.from(out)
}

/**
 * Gives every block node a stable, unique `id` attribute.
 *
 * - New blocks (typed, pasted, split) get an id in the same transaction they appear in.
 * - When a split copies a block, the first occurrence keeps the id and the copy gets a new one.
 * - `keepOnSplit: false` already stops most copies; the plugin catches the rest.
 */
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_TYPES],
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-id'),
            renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockId'),
        props: {
          transformPasted: (slice) => new Slice(stripIds(slice.content), slice.openStart, slice.openEnd),
        },
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null
          const seen = new Set<string>()
          const fix: { pos: number }[] = []
          state.doc.descendants((node, pos) => {
            if (!isBlock(node)) return
            const id = node.attrs.id as string | null
            if (!id || seen.has(id)) fix.push({ pos })
            else seen.add(id)
          })
          if (!fix.length) return null
          const tr = state.tr
          for (const { pos } of fix) tr.setNodeAttribute(pos, 'id', newId())
          return tr.setMeta('addToHistory', false)
        },
      }),
    ]
  },
})

/** Fill in missing block ids in ProseMirror JSON (content built outside an editor). */
export function ensureIds<T extends { type?: string; attrs?: Record<string, unknown>; content?: T[] }>(node: T): T {
  const attrs = (BLOCK_TYPES as readonly string[]).includes(node.type ?? '') && !node.attrs?.id ? { ...node.attrs, id: newId() } : node.attrs
  return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(ensureIds) } : {}) }
}
