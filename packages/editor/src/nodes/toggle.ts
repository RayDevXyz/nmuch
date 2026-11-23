import { Extension, InputRule, Node } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Turn the current block into a toggle (its text becomes the summary line). */
      setToggle: () => ReturnType
      /** Fold or unfold the block the cursor is in (a toggle, a heading, a list item). */
      toggleFold: () => ReturnType
    }
  }
}

/**
 * A toggle: the first line (a paragraph) is the summary, everything after it folds away.
 * `/toggle`, or `>> ` at the start of a line. Enter on an empty last line leaves it; Backspace
 * at the start of the summary turns it back into plain blocks.
 */
export const Toggle = Node.create({
  name: 'toggle',
  // Before the lists' and the default Enter / Backspace handling.
  priority: 1000,
  group: 'block',
  content: 'paragraph block*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }, { tag: 'details' }]
  },

  renderHTML() {
    return ['div', { 'data-type': 'toggle', class: 'bw-toggle' }, 0]
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          const block = $from.parent
          if (!block.isTextblock) return false
          const start = $from.before()
          const end = $from.after()
          const { paragraph, toggle } = state.schema.nodes
          const summary = paragraph.create(null, block.content)
          // Just the summary: Enter at its end starts the folded part.
          const node = toggle.create(null, [summary])
          if (!dispatch) return true
          tr.replaceWith(start, end, node)
          // The cursor goes to the end of the summary line.
          tr.setSelection(TextSelection.create(tr.doc, start + 1 + summary.nodeSize - 1))
          dispatch(tr.scrollIntoView())
          return true
        },
      toggleFold:
        () =>
        ({ state, dispatch, view }) => {
          const target = foldTargetAt(state)
          if (!target) return false
          if (dispatch) flip(view, target)
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      // Enter on an empty last line of a toggle: leave the toggle.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.depth < 2) return false
        const toggle = $from.node(-1)
        if (toggle.type.name !== this.name) return false
        const line = $from.parent
        const index = $from.index(-1)
        if (index === 0 || line.content.size) return false
        // An empty line in the middle: just another line (not a split of the toggle).
        if (index !== toggle.childCount - 1) return editor.commands.splitBlock()
        return editor.chain().command(({ tr }) => {
          const from = $from.before()
          const after = $from.after(-1)
          tr.delete(from, $from.after())
          const at = after - line.nodeSize
          tr.insert(at, editor.schema.nodes.paragraph.create())
          tr.setSelection(TextSelection.create(tr.doc, at + 1))
          return true
        }).run()
      },
      // Backspace at the very start of the summary: unwrap the toggle.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parentOffset !== 0 || $from.depth < 2) return false
        if ($from.node(-1).type.name !== this.name || $from.index(-1) !== 0) return false
        // Unwrap: the toggle's lines become plain blocks where it was.
        return editor.chain().command(({ tr }) => {
          const pos = $from.before(-1)
          const toggle = $from.node(-1)
          tr.replaceWith(pos, pos + toggle.nodeSize, toggle.content)
          tr.setSelection(TextSelection.create(tr.doc, pos + 1))
          return true
        }).run()
      },
      'Mod-Enter': ({ editor }) => editor.commands.toggleFold(),
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^>>\s$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).setToggle().run()
        },
      }),
    ]
  },
})

// ---------------------------------------------------------------- folding

/** Folded block ids, kept on this device (folding is a way of looking, not an edit). */
const STORE = 'bw.folds'
const MAX = 2000

function loadFolds(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORE)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveFolds(s: Set<string>) {
  try {
    globalThis.localStorage?.setItem(STORE, JSON.stringify([...s].slice(-MAX)))
  } catch {
    /* private mode: folds just won't be remembered */
  }
}

const key = new PluginKey<Set<string>>('bwFolding')

const LISTS = ['bulletList', 'orderedList', 'taskList']
const isListItem = (n: PMNode) => n.type.name === 'listItem' || n.type.name === 'taskItem'
const hasSubList = (n: PMNode) => {
  let found = false
  n.forEach((c) => (found ||= LISTS.includes(c.type.name)))
  return found
}

/** The blocks after a heading, up to the next heading of the same or a higher level. */
function section(parent: PMNode, index: number): number {
  const level = parent.child(index).attrs.level as number
  let i = index + 1
  for (; i < parent.childCount; i++) {
    const c = parent.child(i)
    if (c.type.name === 'heading' && (c.attrs.level as number) <= level) break
  }
  return i - index - 1
}

interface Target {
  id: string
  /** Where the caret goes: the start of the block's first line. */
  at: number
}

/** The foldable block around the cursor: the nearest toggle, list item with a sub-list, or heading. */
function foldTargetAt(state: EditorState): Target | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d)
    if (n.type.name === 'toggle' || (isListItem(n) && hasSubList(n))) return n.attrs.id ? { id: n.attrs.id, at: $from.before(d) } : null
    if (n.type.name === 'heading') {
      const parent = $from.node(d - 1)
      if (section(parent, $from.index(d - 1)) > 0 && n.attrs.id) return { id: n.attrs.id, at: $from.before(d) }
    }
  }
  return null
}

function flip(view: EditorView | undefined, t: Target) {
  if (!view) return
  const folds = key.getState(view.state)
  if (!folds) return
  const next = new Set(folds)
  const folding = !next.has(t.id)
  if (folding) next.add(t.id)
  else next.delete(t.id)
  saveFolds(next)
  const tr = view.state.tr.setMeta(key, next)
  // Folding away the cursor: put it on the line that stays visible.
  if (folding) {
    const $at = tr.doc.resolve(t.at + 1)
    const line = $at.nodeAfter?.isTextblock ? t.at + 1 + 1 : t.at + 1
    const head = view.state.selection.head
    const node = tr.doc.nodeAt(t.at)
    if (node && head > t.at && head < t.at + node.nodeSize) {
      const $line = tr.doc.resolve(Math.min(line, tr.doc.content.size))
      tr.setSelection(TextSelection.near($line))
    }
  }
  view.dispatch(tr)
}

function caret(view: EditorView, t: Target, folded: boolean, always: boolean): HTMLElement {
  const b = document.createElement('button')
  b.className = `bw-fold${folded ? ' is-folded' : ''}${always ? ' is-always' : ''}`
  b.contentEditable = 'false'
  b.tabIndex = -1
  b.setAttribute('aria-label', folded ? 'Unfold' : 'Fold')
  b.title = folded ? 'Unfold (Ctrl Enter)' : 'Fold (Ctrl Enter)'
  b.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    flip(view, t)
  })
  return b
}

function decorate(doc: PMNode, folds: Set<string>): DecorationSet {
  const decos: Decoration[] = []
  const widget = (pos: number, t: Target, folded: boolean, always: boolean) =>
    decos.push(
      Decoration.widget(pos, (view) => caret(view, t, folded, always), {
        side: -1,
        ignoreSelection: true,
        key: `fold-${t.id}-${folded ? 1 : 0}`,
      }),
    )
  const walk = (parent: PMNode, offset: number) => {
    let hideUntil = -1
    parent.forEach((n, pos, index) => {
      const at = offset + pos
      if (index <= hideUntil) decos.push(Decoration.node(at, at + n.nodeSize, { class: 'bw-fold-hidden' }))
      const id = n.attrs?.id as string | undefined
      const folded = !!id && folds.has(id)
      if (id && n.type.name === 'toggle') {
        widget(at + 2, { id, at }, folded, true)
        if (folded) decos.push(Decoration.node(at, at + n.nodeSize, { class: 'bw-folded' }))
      } else if (id && isListItem(n) && hasSubList(n)) {
        const first = n.firstChild
        if (first?.isTextblock) widget(at + 2, { id, at }, folded, false)
        if (folded) decos.push(Decoration.node(at, at + n.nodeSize, { class: 'bw-folded' }))
      } else if (id && n.type.name === 'heading') {
        const count = section(parent, index)
        if (count > 0) {
          widget(at + 1, { id, at }, folded, false)
          if (folded) {
            decos.push(Decoration.node(at, at + n.nodeSize, { class: 'bw-folded', 'data-folded': String(count) }))
            hideUntil = Math.max(hideUntil, index + count)
          }
        }
      }
      if (!n.isTextblock && n.childCount && index > hideUntil) walk(n, at + 1)
    })
  }
  walk(doc, 0)
  return DecorationSet.create(doc, decos)
}

/**
 * Folding: a caret before every toggle, every heading with something under it and every list
 * item with a sub-list. Click it (or Ctrl Enter in the block) to fold or unfold.
 */
export const Folding = Extension.create({
  name: 'folding',
  addProseMirrorPlugins() {
    return [
      new Plugin<Set<string>>({
        key,
        state: {
          init: () => loadFolds(),
          apply: (tr: Transaction, value) => (tr.getMeta(key) as Set<string> | undefined) ?? value,
        },
        props: {
          decorations(state) {
            return decorate(state.doc, key.getState(state) ?? new Set())
          },
        },
      }),
    ]
  },
})
