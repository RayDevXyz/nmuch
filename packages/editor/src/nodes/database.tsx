import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    database: {
      insertDatabase: (databaseId: string, viewId: string) => ReturnType
    }
  }
}

/**
 * An inline database. The node only stores which database and which view; the rows live in
 * their own pages and the host renders the table/board/gallery (`EditorHost.DatabaseBlock`).
 */
export const Database = Node.create({
  name: 'database',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-database-id') ?? '',
        renderHTML: (a) => ({ 'data-database-id': a.databaseId }),
      },
      viewId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-view-id') ?? '',
        renderHTML: (a) => ({ 'data-view-id': a.viewId }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database' })]
  },

  addCommands() {
    return {
      insertDatabase:
        (databaseId, viewId) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { databaseId, viewId } }, { type: 'paragraph' }]),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseView, { stopEvent: () => true })
  },
})

function DatabaseView({ node, editor, updateAttributes, selected }: ReactNodeViewProps) {
  const host = maybeHost(editor)
  const Block = host?.DatabaseBlock
  return (
    <NodeViewWrapper className={`database-block ${selected ? 'selected' : ''}`} data-type="database" data-id={node.attrs.id} contentEditable={false}>
      {Block ? (
        <Block
          databaseId={node.attrs.databaseId}
          viewId={node.attrs.viewId}
          editable={editor.isEditable}
          onViewChange={(viewId) => updateAttributes({ viewId })}
        />
      ) : (
        <div className="database-missing">Database</div>
      )}
    </NodeViewWrapper>
  )
}
