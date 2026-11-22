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
      // The callout's colour: '' (the theme's accent) or a hex colour.
      color: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-color') ?? '',
        renderHTML: (a) => (a.color ? { 'data-color': a.color } : {}),
      },
      // How the colour is used: a soft fill, an outline, a bar on the left, or a solid fill.
      variant: {
        default: 'soft',
        parseHTML: (el) => el.getAttribute('data-variant') ?? 'soft',
        renderHTML: (a) => (a.variant && a.variant !== 'soft' ? { 'data-variant': a.variant } : {}),
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

/** Black or white text, whichever reads better on `hex`. */
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#17151c' : '#ffffff'
}

function CalloutView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const host = maybeHost(editor)
  const { color, variant } = node.attrs as { color: string; variant: string }
  const style = {
    ...(color ? { ['--co' as string]: color } : {}),
    ...(variant === 'solid' ? { ['--co-text' as string]: onColor(color || '#8b5cf6') } : {}),
  } as React.CSSProperties
  return (
    <NodeViewWrapper className={`callout co-${variant || 'soft'} ${color ? 'co-custom' : ''}`} data-type="callout" style={style}>
      {host?.pickCalloutStyle && editor.isEditable && (
        <button
          className="callout-style"
          contentEditable={false}
          title="Callout colour and style"
          aria-label="Callout colour and style"
          onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
          onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
            host.pickCalloutStyle!(e.currentTarget.getBoundingClientRect(), { icon: node.attrs.icon, color, variant: variant || 'soft' }, (patch) => updateAttributes(patch))
          }
        >
          <span className="callout-style-dot" />
        </button>
      )}
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
