import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { FileText } from 'lucide-react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      insertPageLink: (pageId: string) => ReturnType
    }
  }
}

/** A sub-page shown as a block. Clicking it opens the page. */
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      pageId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-page-id') ?? '',
        renderHTML: (a) => ({ 'data-page-id': a.pageId }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="page-link"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-link' })]
  },

  renderText({ node }) {
    return `[[${node.attrs.pageId}]]`
  },

  addCommands() {
    return {
      insertPageLink:
        (pageId) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { pageId } }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView)
  },
})

function PageLinkView({ node, editor, selected }: ReactNodeViewProps) {
  const host = maybeHost(editor)
  const id = node.attrs.pageId as string
  const info = host?.useRefTarget('page', id) ?? { title: id, missing: false }
  return (
    <NodeViewWrapper
      className={`page-block ${info.missing ? 'missing' : ''} ${selected ? 'selected' : ''}`}
      data-type="page-link"
      contentEditable={false}
      onClick={(e: React.MouseEvent) => host?.openRef('page', id, e.ctrlKey || e.metaKey)}
    >
      <span className="page-block-icon">{info.icon || <FileText size={16} />}</span>
      <span className="page-block-title">{info.title || 'Untitled'}</span>
    </NodeViewWrapper>
  )
}
