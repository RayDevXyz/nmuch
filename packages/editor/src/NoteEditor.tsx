import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import type * as Y from 'yjs'
import type { EditorHost } from './host'
import { editorExtensions } from './kit'
import { BlockHandle } from './menus/BlockHandle'
import { FormatToolbar } from './menus/FormatToolbar'

export interface NoteEditorProps {
  /** The note's `content` fragment inside the page Y.Doc. */
  fragment: Y.XmlFragment
  host: EditorHost
  editable?: boolean
  spellcheck?: boolean
  /** Called with the editor once it exists, and with null when it is destroyed. */
  onEditor?: (editor: Editor | null) => void
}

/**
 * One Tiptap editor bound to one note. A page in doc mode renders one of these per note;
 * in edgeless mode each note card will host one.
 */
export function NoteEditor({ fragment, host, editable = true, spellcheck = true, onEditor }: NoteEditorProps) {
  const editor = useEditor(
    {
      extensions: editorExtensions({ fragment, host }),
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: 'bw-prose', spellcheck: String(spellcheck) } },
    },
    [fragment, host],
  )

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck))
  }, [editor, spellcheck])

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  if (!editor) return null
  return (
    <div className="note-editor">
      <EditorContent editor={editor} />
      <FormatToolbar editor={editor} />
      <BlockHandle editor={editor} />
    </div>
  )
}
