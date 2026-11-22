import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: {
      /** Insert a formula (an empty one opens its editor). */
      insertFormula: (expr?: string) => ReturnType
    }
  }
}

/**
 * A live value in the text: a formula over page properties and database values. The node
 * stores only the formula (`expr`); the host evaluates and shows it (`EditorHost.FormulaInline`).
 * Typing `{{= … }}` makes one; so does `/formula`.
 */
export const Formula = Node.create({
  name: 'formula',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      expr: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-expr') ?? '',
        renderHTML: (a) => ({ 'data-expr': a.expr }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="formula"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'formula' }), `{{= ${node.attrs.expr}}}`]
  },

  renderText({ node }) {
    return `{{= ${node.attrs.expr}}}`
  },

  addCommands() {
    return {
      insertFormula:
        (expr = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { expr } }),
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\{\{=\s*([^{}]+?)\s*\}\}$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ expr: match[1] }))
        },
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormulaView, { as: 'span', stopEvent: () => true })
  },
})

function FormulaView({ node, editor, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const View = maybeHost(editor)?.FormulaInline
  return (
    <NodeViewWrapper as="span" className="formula-node" data-type="formula" contentEditable={false}>
      {View ? (
        <View expr={node.attrs.expr} editable={editor.isEditable} onChange={(expr) => updateAttributes({ expr })} onDelete={deleteNode} />
      ) : (
        <code>{`{{= ${node.attrs.expr}}}`}</code>
      )}
    </NodeViewWrapper>
  )
}
