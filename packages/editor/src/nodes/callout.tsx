import { mergeAttributes, Node, textblockTypeInputRule } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (icon?: string) => ReturnType
    }
  }
}

/** A highlighted text block with an emoji. Markdown shortcut: `!> `. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      icon: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-icon') ?? '💡',
        renderHTML: (a) => ({ 'data-icon': a.icon }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'callout' }), 0]
  },

  addCommands() {
    return {
      setCallout:
        (icon = '💡') =>
        ({ commands }) =>
          commands.setNode(this.name, { icon }),
    }
  },

  addInputRules() {
    return [textblockTypeInputRule({ find: /^!>\s$/, type: this.type, getAttributes: { icon: '💡' } })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})

function CalloutView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const host = maybeHost(editor)
  return (
    <NodeViewWrapper className="callout" data-type="callout">
      <button
        className="callout-icon"
        contentEditable={false}
        disabled={!editor.isEditable}
        onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
        onClick={async (e: React.MouseEvent<HTMLButtonElement>) => {
          const icon = await host?.pickEmoji(e.currentTarget.getBoundingClientRect())
          if (icon) updateAttributes({ icon })
        }}
      >
        {node.attrs.icon}
      </button>
      <NodeViewContent className="callout-text" />
    </NodeViewWrapper>
  )
}
