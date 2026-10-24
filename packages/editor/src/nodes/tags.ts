import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/** Same rule as the Rust indexer (`extract_tags`): `#` after start/space/`(`, then a letter or `_`. */
export const TAG_RE = /(^|[\s(])#([\p{L}_][\p{L}\p{N}_\-/]*)/gu

function decorate(doc: PMNode) {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'code')) return
    TAG_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TAG_RE.exec(node.text))) {
      const from = pos + m.index + m[1].length
      decos.push(Decoration.inline(from, from + m[2].length + 1, { class: 'tag', 'data-tag': m[2].toLowerCase() }))
    }
  })
  return DecorationSet.create(doc, decos)
}

/** Highlights `#tags` in text. Indexing happens in the Rust core, not here. */
export const Tags = Extension.create({
  name: 'tags',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tags'),
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})
