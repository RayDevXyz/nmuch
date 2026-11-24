import { mergeAttributes, Node, type JSONContent } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    actionButton: {
      insertButton: (settings?: Record<string, unknown>) => ReturnType
    }
  }
}

const parse = (s: unknown): Record<string, unknown> => {
  if (s && typeof s === 'object') return s as Record<string, unknown>
  try {
    return JSON.parse(String(s || '{}'))
  } catch {
    return {}
  }
}

/**
 * A button that does something when clicked: make a page, add text somewhere, open a page.
 * The node only stores its settings (its look and its steps, as JSON); the host draws it, edits
 * it and runs the steps (`EditorHost.ButtonBlock`).
 */
export const ActionButton = Node.create({
  name: 'button',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      settings: {
        default: '{}',
        parseHTML: (el) => el.getAttribute('data-settings') ?? '{}',
        renderHTML: (a) => ({ 'data-settings': a.settings }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="button"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'button' })]
  },

  addCommands() {
    return {
      insertButton:
        (settings = {}) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { settings: JSON.stringify(settings) } }, { type: 'paragraph' }]),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ButtonView, { stopEvent: () => true })
  },
})

function ButtonView({ node, editor, updateAttributes, selected, getPos }: ReactNodeViewProps) {
  const Block = maybeHost(editor)?.ButtonBlock
  // Put blocks right after the button (an "add text below" step).
  const insertBelow = (content: JSONContent[]) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return
    editor.chain().insertContentAt(pos + node.nodeSize, content).run()
  }
  return (
    <NodeViewWrapper className={`button-block ${selected ? 'selected' : ''}`} data-type="button" data-id={node.attrs.id} contentEditable={false}>
      {Block ? (
        <Block
          blockId={node.attrs.id ?? ''}
          settings={parse(node.attrs.settings)}
          editable={editor.isEditable}
          onSettings={(s) => updateAttributes({ settings: JSON.stringify(s) })}
          insertBelow={insertBelow}
        />
      ) : (
        <div className="database-missing">Button</div>
      )}
    </NodeViewWrapper>
  )
}
