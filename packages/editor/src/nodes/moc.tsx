import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    moc: {
      insertMoc: (settings?: Record<string, unknown>) => ReturnType
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
 * A map of content: a live list of links to pages (this page's sub-pages, pages with a tag,
 * a database's rows, or the whole workspace). The node only stores the settings, as JSON; the
 * host works out the pages and renders them (`EditorHost.MocBlock`), so it's never out of date.
 */
export const Moc = Node.create({
  name: 'moc',
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
    return [{ tag: 'div[data-type="moc"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'moc' })]
  },

  addCommands() {
    return {
      insertMoc:
        (settings = {}) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { settings: JSON.stringify(settings) } }, { type: 'paragraph' }]),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MocView, { stopEvent: () => true })
  },
})

function MocView({ node, editor, updateAttributes, selected }: ReactNodeViewProps) {
  const Block = maybeHost(editor)?.MocBlock
  return (
    <NodeViewWrapper className={`moc-block ${selected ? 'selected' : ''}`} data-type="moc" data-id={node.attrs.id} contentEditable={false}>
      {Block ? (
        <Block
          blockId={node.attrs.id ?? ''}
          settings={parse(node.attrs.settings)}
          editable={editor.isEditable}
          onSettings={(s) => updateAttributes({ settings: JSON.stringify(s) })}
        />
      ) : (
        <div className="database-missing">Map of content</div>
      )}
    </NodeViewWrapper>
  )
}
