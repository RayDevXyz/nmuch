import { Node } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** Insert a row of `count` columns (the current block goes into the first one if it has text). */
      insertColumns: (count: number) => ReturnType
    }
  }
}

const parseWidths = (s: unknown, n: number): number[] => {
  const w = String(s ?? '')
    .split(',')
    .map(Number)
    .filter((x) => x > 0)
  // Extra widths (a column was removed) are dropped; missing ones are the average.
  if (!w.length) return Array(n).fill(1)
  const avg = w.reduce((a, b) => a + b, 0) / w.length
  return Array.from({ length: n }, (_, i) => w[i] ?? avg)
}

/** One column: any blocks. */
export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'column', class: 'bw-column' }, 0]
  },
})

/**
 * Columns side by side. `widths`: the columns' relative widths, as "1,2,1" (empty: equal).
 * Drag the line between two columns to resize; "+" adds a column; Backspace in an empty column
 * removes it; a single column left turns back into plain blocks.
 */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column+',
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      widths: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-widths') ?? '',
        renderHTML: (a) => (a.widths ? { 'data-widths': a.widths } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'columns', class: 'bw-columns' }, 0]
  },

  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ state, tr, dispatch }) => {
          const n = Math.max(2, Math.min(5, count))
          const { schema } = state
          const { $from } = state.selection
          const here = $from.parent
          const keep = here.type.name === 'paragraph' && here.textContent.trim() ? here.copy(here.content) : null
          const cols = Array.from({ length: n }, (_, i) =>
            schema.nodes.column.create(null, i === 0 && keep ? keep : schema.nodes.paragraph.create()),
          )
          const node = schema.nodes.columns.create(null, cols)
          if (!dispatch) return true
          // Replace the current line when it's empty or moves into the first column; else add after it.
          const empty = here.isTextblock && here.content.size === 0
          const from = $from.depth > 0 ? $from.before() : $from.pos
          const to = $from.depth > 0 ? $from.after() : $from.pos
          if (keep || empty) tr.replaceWith(from, to, node)
          else tr.insert(to, node)
          const start = keep || empty ? from : to
          // The cursor goes into the first column (at the end of a kept line).
          tr.setSelection(TextSelection.create(tr.doc, start + 3 + (keep ? keep.content.size : 0)))
          // A line after the columns, so there's somewhere to keep writing.
          const after = start + node.nodeSize
          if (after >= tr.doc.content.size || tr.doc.resolve(after).nodeAfter?.type.name === 'columns') tr.insert(after, schema.nodes.paragraph.create())
          dispatch(tr.scrollIntoView())
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      // In an empty column, Backspace at its start removes the column.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parentOffset !== 0) return false
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d)
          if (n.type.name !== 'column') continue
          if (n.childCount !== 1 || n.firstChild?.content.size) return false
          const pos = $from.before(d)
          const row = $from.node(d - 1)
          const index = $from.index(d - 1)
          const tr = editor.state.tr.delete(pos, pos + n.nodeSize)
          // Its width goes too, so the others keep theirs.
          if (row.type.name === 'columns' && row.childCount > 2) {
            const w = parseWidths(row.attrs.widths, row.childCount)
            w.splice(index, 1)
            tr.setNodeMarkup($from.before(d - 1), undefined, { ...row.attrs, widths: w.join(',') })
          }
          const at = Math.max(0, Math.min(pos - 1, tr.doc.content.size))
          editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at), -1)).scrollIntoView())
          return true
        }
        return false
      },
    }
  },

  addNodeView() {
    return ({ node, view, getPos }) => new ColumnsView(node, view, getPos as () => number | undefined)
  },

  addProseMirrorPlugins() {
    return [
      // A row with a single column left is just its blocks again.
      new Plugin({
        key: new PluginKey('columnsUnwrap'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null
          let tr = null as ReturnType<typeof state.tr.replaceWith> | null
          state.doc.descendants((n, pos) => {
            if (n.type.name !== 'columns' || n.childCount !== 1) return
            tr ??= state.tr
            const p = tr.mapping.map(pos)
            tr.replaceWith(p, p + n.nodeSize, n.firstChild!.content)
            return false
          })
          return tr
        },
      }),
    ]
  },
})

/** The grid, with a drag handle on each line between two columns and a "+" to add one. */
class ColumnsView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private handles: HTMLElement
  private add: HTMLButtonElement

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'bw-columns-wrap'
    this.dom.setAttribute('data-type', 'columns')
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'bw-columns'
    this.handles = document.createElement('div')
    this.handles.className = 'bw-col-handles'
    this.handles.contentEditable = 'false'
    this.add = document.createElement('button')
    this.add.className = 'bw-col-add'
    this.add.type = 'button'
    this.add.contentEditable = 'false'
    this.add.title = 'Add a column'
    this.add.textContent = '+'
    this.add.addEventListener('mousedown', (e) => e.preventDefault())
    this.add.addEventListener('click', () => this.addColumn())
    this.dom.append(this.contentDOM, this.handles, this.add)
    this.render()
  }

  private widths() {
    return parseWidths(this.node.attrs.widths, this.node.childCount)
  }

  private render() {
    const w = this.widths()
    this.contentDOM.style.gridTemplateColumns = w.map((x) => `minmax(0, ${x}fr)`).join(' ')
    this.dom.setAttribute('data-id', String(this.node.attrs.id ?? ''))
    this.add.hidden = this.node.childCount >= 5 || !this.view.editable
    this.handles.replaceChildren()
    if (!this.view.editable) return
    const total = w.reduce((a, b) => a + b, 0)
    let acc = 0
    for (let i = 0; i < w.length - 1; i++) {
      acc += w[i]
      const h = document.createElement('div')
      h.className = 'bw-col-handle'
      h.style.left = `calc(${(acc / total) * 100}% - 3px)`
      h.title = 'Drag to resize'
      h.addEventListener('pointerdown', (e) => this.drag(e, i))
      this.handles.append(h)
    }
  }

  private setWidths(w: number[]) {
    const pos = this.getPos()
    if (pos === undefined) return
    const widths = w.map((x) => Math.round(x * 100) / 100).join(',')
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, widths }))
  }

  private drag(e: PointerEvent, i: number) {
    e.preventDefault()
    const box = this.contentDOM.getBoundingClientRect()
    const start = this.widths()
    const total = start.reduce((a, b) => a + b, 0)
    const pair = start[i] + start[i + 1]
    const before = start.slice(0, i).reduce((a, b) => a + b, 0)
    const move = (ev: PointerEvent) => {
      const frac = ((ev.clientX - box.left) / box.width) * total - before
      const left = Math.max(pair * 0.12, Math.min(pair * 0.88, frac))
      const w = [...start]
      w[i] = left
      w[i + 1] = pair - left
      this.setWidths(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      this.dom.classList.remove('resizing')
    }
    this.dom.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  private addColumn() {
    const pos = this.getPos()
    if (pos === undefined) return
    const { schema } = this.view.state
    const col = schema.nodes.column.create(null, schema.nodes.paragraph.create())
    const end = pos + this.node.nodeSize - 1
    const w = this.widths()
    const tr = this.view.state.tr.insert(end, col)
    tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, widths: [...w, w.reduce((a, b) => a + b, 0) / w.length].join(',') })
    tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2)))
    this.view.dispatch(tr)
    this.view.focus()
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  ignoreMutation(m: ViewMutationRecord) {
    // Our own handles and button aren't document content.
    return m.type !== 'selection' && (this.handles.contains(m.target as globalThis.Node) || this.add.contains(m.target as globalThis.Node) || m.target === this.dom)
  }

  stopEvent(e: Event) {
    return this.handles.contains(e.target as globalThis.Node) || this.add.contains(e.target as globalThis.Node)
  }
}
