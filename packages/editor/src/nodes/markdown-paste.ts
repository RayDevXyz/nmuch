import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { maybeHost } from '../host-extension'

const LOOKS_LIKE_MD = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\[[ xX]?\]\s)|\*\*[^*]+\*\*|\[\[[^\]]+\]\]|(^|\n)\s*\|.*\|\s*\n\s*\|?\s*:?-{2,}/

/** Paste of plain-text Markdown becomes blocks (headings, lists, to-dos, code, ...). */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (!data || data.types.includes('text/html') || data.files.length) return false
            const text = data.getData('text/plain')
            const host = maybeHost(editor)
            if (!text || !host?.markdownToContent || !LOOKS_LIKE_MD.test(text)) return false
            if (view.state.selection.$from.parent.type.name === 'codeBlock') return false
            const content = host.markdownToContent(text)
            if (!content?.length) return false
            event.preventDefault()
            editor.chain().focus().insertContent(content).run()
            return true
          },
          // Things dragged in from the app (see EditorHost.dropContent).
          handleDrop: (view, event) => {
            const data = event.dataTransfer
            const host = maybeHost(editor)
            if (!data || !host?.dropContent || data.files.length) return false
            const content = host.dropContent(data)
            if (!content?.length) return false
            event.preventDefault()
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!at) {
              editor.chain().focus().insertContent(content).run()
              return true
            }
            // Between blocks, never inside a sentence: before the paragraph it lands on if
            // that's at its start, else after it.
            const $pos = view.state.doc.resolve(at.pos)
            const pos = $pos.parent.isTextblock && $pos.depth > 0 ? ($pos.parentOffset === 0 ? $pos.before() : $pos.after()) : at.pos
            editor.chain().focus().insertContentAt(pos, content).run()
            return true
          },
        },
      }),
    ]
  },
})
