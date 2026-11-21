import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { findParentNode } from '@tiptap/core'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Heading,
  Merge,
  Rows3,
  Split,
  Trash2,
} from 'lucide-react'

/** The table the cursor is in, as a DOM element (to place the menu above it). */
function tableElement(editor: Editor): HTMLElement | null {
  const found = findParentNode((n) => n.type.name === 'table')(editor.state.selection)
  if (!found) return null
  const dom = editor.view.nodeDOM(found.pos) as HTMLElement | null
  // With resizable columns the node's DOM is a wrapper div around the <table>.
  return dom?.querySelector?.('table') ?? dom
}

/** Rows, columns, header and merge controls, shown above a table while the cursor is in it. */
export function TableMenu({ editor }: { editor: Editor }) {
  const can = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      inTable: e.isActive('table'),
      merge: e.can().mergeCells(),
      split: e.can().splitCell(),
      deleteRow: e.can().deleteRow(),
      deleteColumn: e.can().deleteColumn(),
    }),
  })
  if (!can.inTable) return null

  const btn = (label: string, icon: React.ReactNode, run: () => boolean, enabled = true, danger = false) => (
    <button
      className={`fmt-btn ${danger ? 'danger' : ''}`}
      aria-label={label}
      title={label}
      disabled={!enabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run()}
    >
      {icon}
    </button>
  )
  const c = () => editor.chain().focus()

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      className="inline-toolbar bw-bubble table-menu"
      options={{ placement: 'top-start', offset: 8, flip: false }}
      getReferencedVirtualElement={() => tableElement(editor)}
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('table')}
    >
      {btn('Add a row above', <ArrowUpToLine size={14} />, () => c().addRowBefore().run())}
      {btn('Add a row below', <ArrowDownToLine size={14} />, () => c().addRowAfter().run())}
      {btn('Delete this row', <Rows3 size={14} />, () => c().deleteRow().run(), can.deleteRow)}
      <span className="tb-sep" />
      {btn('Add a column to the left', <ArrowLeftToLine size={14} />, () => c().addColumnBefore().run())}
      {btn('Add a column to the right', <ArrowRightToLine size={14} />, () => c().addColumnAfter().run())}
      {btn('Delete this column', <Columns3 size={14} />, () => c().deleteColumn().run(), can.deleteColumn)}
      <span className="tb-sep" />
      {btn('Header row on or off', <Heading size={14} />, () => c().toggleHeaderRow().run())}
      {btn('Merge cells', <Merge size={14} />, () => c().mergeCells().run(), can.merge)}
      {btn('Split cell', <Split size={14} />, () => c().splitCell().run(), can.split)}
      <span className="tb-sep" />
      {btn('Delete the table', <Trash2 size={14} />, () => c().deleteTable().run(), true, true)}
    </BubbleMenu>
  )
}
