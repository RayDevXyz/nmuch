import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Code, Italic, Link2, Strikethrough, Underline } from 'lucide-react'
import { useState } from 'react'

/** Bold, italic, underline, strike, inline code and link, shown over a text selection. */
export function FormatToolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState<string | null>(null)
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
    }),
  })

  const btn = (key: keyof typeof active, label: string, icon: React.ReactNode, run: () => void) => (
    <button
      key={key}
      className={`fmt-btn ${active[key] ? 'on' : ''}`}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  )

  return (
    <BubbleMenu
      editor={editor}
      className="inline-toolbar"
      shouldShow={({ editor: e, from, to }) =>
        e.isEditable && from !== to && !e.isActive('codeBlock') && !e.isActive('image') && !e.isActive('pageLink')
      }
    >
      {linking === null ? (
        <>
          {btn('bold', 'Bold (Ctrl B)', <Bold size={14} />, () => editor.chain().focus().toggleBold().run())}
          {btn('italic', 'Italic (Ctrl I)', <Italic size={14} />, () => editor.chain().focus().toggleItalic().run())}
          {btn('underline', 'Underline (Ctrl U)', <Underline size={14} />, () => editor.chain().focus().toggleUnderline().run())}
          {btn('strike', 'Strikethrough', <Strikethrough size={14} />, () => editor.chain().focus().toggleStrike().run())}
          {btn('code', 'Inline code (Ctrl E)', <Code size={14} />, () => editor.chain().focus().toggleCode().run())}
          {btn('link', 'Link', <Link2 size={14} />, () =>
            active.link ? editor.chain().focus().unsetLink().run() : setLinking(editor.getAttributes('link').href ?? ''),
          )}
        </>
      ) : (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            const href = linking.trim()
            if (href) editor.chain().focus().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(href) ? href : `https://${href}` }).run()
            setLinking(null)
          }}
        >
          <input
            autoFocus
            placeholder="Paste a link…"
            value={linking}
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setLinking(null)}
            onBlur={() => setLinking(null)}
          />
        </form>
      )}
    </BubbleMenu>
  )
}
