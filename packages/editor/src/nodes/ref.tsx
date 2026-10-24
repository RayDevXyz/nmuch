import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'
import type { RefKind } from '../schema'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ref: {
      insertRef: (kind: RefKind, target: string) => ReturnType
    }
  }
}

/**
 * An inline reference to a page (`[[`) or a block (`((`). It stores only the target id;
 * the label is the target's *current* title, looked up through the host.
 */
export const Ref = Node.create({
  name: 'ref',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'page' },
      target: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="ref"]',
        getAttrs: (el) => ({ kind: el.getAttribute('data-kind') ?? 'page', target: el.getAttribute('data-target') ?? '' }),
      },
      // Page links in Nimbus' inline HTML.
      { tag: 'a.page-link[data-page]', getAttrs: (el) => ({ kind: 'page', target: el.getAttribute('data-page') ?? '' }) },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'ref', 'data-kind': node.attrs.kind, 'data-target': node.attrs.target }),
      node.attrs.kind === 'block' ? '((ref))' : '[[ref]]',
    ]
  },

  renderText({ node }) {
    return node.attrs.kind === 'block' ? `((${node.attrs.target}))` : `[[${node.attrs.target}]]`
  },

  addCommands() {
    return {
      insertRef:
        (kind, target) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { kind, target } }, { type: 'text', text: ' ' }]),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(RefView, { as: 'span' })
  },
})

function RefView({ node, editor, selected }: ReactNodeViewProps) {
  const host = maybeHost(editor)
  const kind = node.attrs.kind as RefKind
  const target = node.attrs.target as string
  const info = host?.useRefTarget(kind, target) ?? { title: target, missing: false }
  return (
    <NodeViewWrapper
      as="span"
      className={`ref ref-${kind} ${kind === 'page' ? 'page-link' : 'block-ref'} ${info.missing ? 'missing' : ''} ${selected ? 'selected' : ''}`}
      data-target={target}
      contentEditable={false}
      onClick={(e: React.MouseEvent) => host?.openRef(kind, target, e.ctrlKey || e.metaKey)}
      onAuxClick={(e: React.MouseEvent) => e.button === 1 && host?.openRef(kind, target, true)}
    >
      {info.icon && kind === 'page' ? <span className="ref-icon">{info.icon}</span> : null}
      {info.title || 'Untitled'}
    </NodeViewWrapper>
  )
}
