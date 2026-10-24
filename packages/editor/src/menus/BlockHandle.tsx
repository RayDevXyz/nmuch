import type { Editor } from '@tiptap/core'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { Copy, GripVertical, Plus, Smile, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { maybeHost } from '../host-extension'
import { runSlash, slashItem, TURN_INTO, type SlashId } from './items'

const currentType = (n: PMNode): SlashId | null => {
  switch (n.type.name) {
    case 'paragraph':
      return 'text'
    case 'heading':
      return (`h${n.attrs.level}` as SlashId)
    case 'bulletList':
      return 'bullet'
    case 'orderedList':
      return 'numbered'
    case 'taskList':
      return 'todo'
    case 'blockquote':
      return 'quote'
    case 'callout':
      return 'callout'
    case 'codeBlock':
      return 'code'
    default:
      return null
  }
}

/**
 * The grip left of the hovered block: drag it to move the block, click it for
 * "Turn into", duplicate and delete.
 */
export function BlockHandle({ editor }: { editor: Editor }) {
  const target = useRef<{ node: PMNode; pos: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; top: number; node: PMNode; pos: number } | null>(null)
  const menuEl = useRef<HTMLDivElement>(null)

  // Open upwards when there isn't room below the handle.
  useLayoutEffect(() => {
    const el = menuEl.current
    if (!el || !menu) return
    const h = el.offsetHeight
    const y = menu.y + h > window.innerHeight - 8 ? Math.max(8, menu.top - h - 4) : menu.y
    el.style.top = `${y}px`
    el.style.visibility = 'visible'
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.block-menu')) setMenu(null)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    const t = setTimeout(() => document.addEventListener('mousedown', close), 0)
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [menu])

  if (!editor.isEditable) return null

  const selectBlock = (pos: number) => editor.chain().focus().command(({ tr }) => {
    tr.setSelection(NodeSelection.create(tr.doc, pos))
    return true
  }).run()

  const act = (fn: (m: NonNullable<typeof menu>) => void) => () => {
    if (menu) fn(menu)
    setMenu(null)
  }

  const cur = menu ? currentType(menu.node) : null

  return (
    <>
      <DragHandle
        editor={editor}
        onNodeChange={({ node, pos }) => {
          target.current = node ? { node, pos } : null
        }}
      >
        <div className="block-handle">
          <button
            className="gutter-btn"
            aria-label="Add block below"
            title="Add block below"
            onClick={() => {
              const t = target.current
              if (!t) return
              const at = t.pos + t.node.nodeSize
              editor.chain().focus().insertContentAt(at, { type: 'paragraph', content: [{ type: 'text', text: '/' }] }).run()
            }}
          >
            <Plus size={15} />
          </button>
          <button
            className="gutter-btn grip"
            aria-label="Drag to move, click for options"
            title="Drag to move · click for options"
            onClick={(e) => {
              const t = target.current
              if (!t) return
              const r = e.currentTarget.getBoundingClientRect()
              selectBlock(t.pos)
              setMenu({ x: r.left, y: r.bottom + 4, top: r.top, ...t })
            }}
          >
            <GripVertical size={15} />
          </button>
        </div>
      </DragHandle>
      {menu &&
        createPortal(
          <div ref={menuEl} className="popover block-menu" style={{ left: menu.x, top: menu.y, visibility: 'hidden' }}>
            {cur && (
              <>
                <div className="menu-caption">Turn into</div>
                <div className="turn-grid">
                  {TURN_INTO.map((t) => {
                    const it = slashItem(t)
                    return (
                      <button
                        key={t}
                        className={`turn-item ${cur === t ? 'current' : ''}`}
                        title={it.label}
                        onClick={act((m) => {
                          editor.chain().focus().setTextSelection(m.pos + 1).run()
                          runSlash(editor, t)
                        })}
                      >
                        <it.icon size={15} />
                        <span>{it.label}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="menu-sep" />
              </>
            )}
            <div className="menu-list">
              {menu.node.type.name === 'callout' && (
                <button
                  className="menu-item"
                  onClick={act(async (m) => {
                    const icon = await maybeHost(editor)?.pickEmoji(new DOMRect(m.x, m.y, 0, 0))
                    if (icon) editor.chain().command(({ tr }) => (tr.setNodeAttribute(m.pos, 'icon', icon), true)).run()
                  })}
                >
                  <span className="menu-icon"><Smile size={14} /></span>
                  <span className="menu-label">Change icon</span>
                </button>
              )}
              <button
                className="menu-item"
                onClick={act((m) => {
                  const json = m.node.toJSON()
                  editor.chain().focus().insertContentAt(m.pos + m.node.nodeSize, json).run()
                })}
              >
                <span className="menu-icon"><Copy size={14} /></span>
                <span className="menu-label">Duplicate</span>
              </button>
              <div className="menu-sep" />
              <button
                className="menu-item danger"
                onClick={act((m) => {
                  editor.chain().focus().deleteRange({ from: m.pos, to: m.pos + m.node.nodeSize }).run()
                })}
              >
                <span className="menu-icon"><Trash2 size={14} /></span>
                <span className="menu-label">Delete</span>
                <kbd className="menu-hint">Del</kbd>
              </button>
            </div>
          </div>,
          document.querySelector('.workspace') ?? document.body,
        )}
    </>
  )
}
