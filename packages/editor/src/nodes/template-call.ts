import { Extension, type JSONContent } from '@tiptap/core'
import { maybeHost } from '../host-extension'

const CALL = /^\s*\{\{\s*template\s*:[^{}]*\}\}\s*$/i

/**
 * Typing `{{template: Name | Field: value}}` on a line of its own and pressing Enter uses that
 * template (see `EditorHost.templateCall`). The line stays until the host answers, then becomes
 * what it returns (usually a link to the new page); if it's cancelled the line stays as typed.
 */
export const TemplateCall = Extension.create({
  name: 'templateCall',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const host = maybeHost(editor)
        if (!host?.templateCall) return false
        const { $from, empty } = editor.state.selection
        const line = $from.parent
        if (!empty || !line.isTextblock || line.type.name === 'codeBlock' || !CALL.test(line.textContent)) return false
        const pending = host.templateCall(line.textContent)
        if (!pending) return false
        const id = line.attrs.id as string | null
        void pending.then((content: JSONContent[] | null) => {
          if (!content?.length || editor.isDestroyed) return
          // The line may have moved meanwhile: find it again by its block id.
          let at = -1
          let size = 0
          editor.state.doc.descendants((n, pos) => {
            if (at >= 0) return false
            if (n.attrs.id === id && n.isTextblock) {
              at = pos
              size = n.nodeSize
              return false
            }
          })
          if (at < 0) return
          editor.chain().focus().insertContentAt({ from: at, to: at + size }, [...content, { type: 'paragraph' }]).run()
        })
        return true
      },
    }
  },
})
