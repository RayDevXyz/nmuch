import { mergeAttributes, Node } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { maybeHost } from '../host-extension'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      insertImage: (src: string, caption?: string) => ReturnType
    }
  }
}

/** A block image with an editable caption. Dropped or pasted image files become images. */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '', renderHTML: () => ({}) },
      caption: { default: '', renderHTML: () => ({}) },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image"]',
        getAttrs: (el) => {
          const img = el.querySelector('img')
          return { src: img?.getAttribute('src') ?? '', caption: el.querySelector('figcaption')?.textContent ?? '' }
        },
      },
      { tag: 'img[src]', getAttrs: (el) => ({ src: el.getAttribute('src'), caption: el.getAttribute('alt') ?? '' }) },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-type': 'image' }),
      ['img', { src: node.attrs.src, alt: node.attrs.caption }],
      ['figcaption', {}, node.attrs.caption],
    ]
  },

  addCommands() {
    return {
      insertImage:
        (src, caption = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src, caption } }),
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const insertFiles = (files: File[], pos?: number) => {
      const host = maybeHost(editor)
      if (!host || !files.length) return false
      void Promise.all(files.map((f) => host.readImage(f))).then((srcs) => {
        const content = srcs.map((src) => ({ type: 'image', attrs: { src, caption: '' } }))
        if (pos === undefined) editor.chain().focus().insertContent(content).run()
        else editor.chain().focus().insertContentAt(pos, content).run()
      })
      return true
    }
    const images = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const files = images(event.clipboardData?.files)
            if (!files.length) return false
            event.preventDefault()
            return insertFiles(files)
          },
          handleDrop: (view, event) => {
            const files = images(event.dataTransfer?.files)
            if (!files.length) return false
            event.preventDefault()
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            return insertFiles(files, at?.pos)
          },
        },
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})

function ImageView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper className={`image-block ${selected ? 'selected' : ''}`} data-type="image">
      {node.attrs.src ? <img src={node.attrs.src} alt={node.attrs.caption} draggable={false} /> : <div className="image-empty">No image</div>}
      <input
        className="image-caption"
        placeholder="Add a caption"
        value={node.attrs.caption}
        readOnly={!editor.isEditable}
        onChange={(e) => updateAttributes({ caption: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </NodeViewWrapper>
  )
}
