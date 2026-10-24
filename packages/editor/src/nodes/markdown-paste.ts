import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { maybeHost } from '../host-extension'

const LOOKS_LIKE_MD = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\[[ xX]?\]\s)|\*\*[^*]+\*\*|\[\[[^\]]+\]\]/

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
        },
      }),
    ]
  },
})
