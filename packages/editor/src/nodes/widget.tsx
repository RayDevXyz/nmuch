import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    widget: {
      insertWidget: (widgetId: string) => ReturnType
    }
  }
}

const parse = (s: unknown): Record<string, unknown> => {
  if (typeof s !== 'string') return {}
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/**
 * A widget instance. The node stores which widget, how its slots are bound to databases and the
 * widget's own settings; bindings and settings are JSON text, so the attribute compares equal to
 * itself across syncs. The host renders it (`EditorHost.WidgetBlock`) in a sandbox, and the Rust
 * core checks every data call against these bindings.
 */
export const Widget = Node.create({
  name: 'widget',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      widget: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-widget') ?? '',
        renderHTML: (a) => ({ 'data-widget': a.widget }),
      },
      bindings: {
        default: '{}',
        parseHTML: (el) => el.getAttribute('data-bindings') ?? '{}',
        renderHTML: (a) => ({ 'data-bindings': a.bindings }),
      },
      settings: {
        default: '{}',
        parseHTML: (el) => el.getAttribute('data-settings') ?? '{}',
        renderHTML: (a) => ({ 'data-settings': a.settings }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="widget"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'widget' })]
  },

  addCommands() {
    return {
      insertWidget:
        (widgetId) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { widget: widgetId } }, { type: 'paragraph' }]),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(WidgetView, { stopEvent: () => true })
  },
})

function WidgetView({ node, editor, updateAttributes, selected }: ReactNodeViewProps) {
  const host = maybeHost(editor)
  const Block = host?.WidgetBlock
  return (
    <NodeViewWrapper className={`widget-block ${selected ? 'selected' : ''}`} data-type="widget" data-id={node.attrs.id} contentEditable={false}>
      {Block && node.attrs.id ? (
        <Block
          widgetId={node.attrs.widget}
          blockId={node.attrs.id}
          bindings={parse(node.attrs.bindings)}
          settings={parse(node.attrs.settings)}
          editable={editor.isEditable}
          onBindings={(b) => updateAttributes({ bindings: JSON.stringify(b) })}
          onSettings={(s) => updateAttributes({ settings: JSON.stringify(s) })}
        />
      ) : (
        <div className="widget-missing">Widget</div>
      )}
    </NodeViewWrapper>
  )
}
