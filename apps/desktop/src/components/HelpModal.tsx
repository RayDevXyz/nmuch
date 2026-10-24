import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { setState } from '../state/store'

const GROUPS: [string, [string, string][]][] = [
  [
    'General',
    [
      ['Ctrl K', 'Quick find'],
      ['Ctrl N', 'New page'],
      ['Ctrl W', 'Close tab'],
      ['Ctrl Tab', 'Next tab'],
      ['Ctrl \\', 'Toggle sidebar'],
      ['Ctrl Shift \\', 'Toggle graph panel'],
      ['Ctrl /', 'This help'],
    ],
  ],
  [
    'Blocks',
    [
      ['/', 'Insert or convert a block'],
      ['[[', 'Link to a page'],
      ['Enter / Shift Enter', 'New block / line break'],
      ['Tab / Shift Tab', 'Indent / outdent'],
      ['Esc', 'Select block'],
      ['Ctrl D', 'Duplicate block'],
      ['Alt Shift ↑ ↓', 'Move block'],
      ['Ctrl Alt 0–3', 'Text / Heading 1–3'],
      ['Ctrl Shift 7 8 9', 'Numbered / bullet / to-do'],
      ['Ctrl Enter', 'Toggle to-do'],
      ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
    ],
  ],
  [
    'Formatting',
    [
      ['Ctrl B / I / U', 'Bold / italic / underline'],
      ['Ctrl E', 'Inline code'],
      ['Ctrl Shift X', 'Strikethrough'],
      ['Ctrl K (with selection)', 'Add link'],
      ['Ctrl click', 'Open link'],
    ],
  ],
  [
    'Markdown shortcuts',
    [
      ['# ## ###', 'Headings'],
      ['- or *', 'Bulleted list'],
      ['1.', 'Numbered list'],
      ['[] ', 'To-do'],
      ['>', 'Quote'],
      ['!>', 'Callout'],
      ['```', 'Code block'],
      ['---', 'Divider'],
    ],
  ],
  [
    'Selected blocks',
    [
      ['↑ ↓ / Shift ↑ ↓', 'Move / extend selection'],
      ['Backspace', 'Delete'],
      ['Ctrl C / Ctrl X', 'Copy / cut as Markdown'],
      ['Enter', 'Edit block'],
    ],
  ],
]

export function HelpModal() {
  const close = () => setState({ help: false })
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="help-modal" role="dialog" aria-label="Keyboard shortcuts">
        <div className="help-head">
          <strong>Keyboard shortcuts</strong>
          <button className="icon-button" autoFocus onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="help-grid">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              {rows.map(([k, d]) => (
                <div className="help-row" key={k}>
                  <span>{d}</span>
                  <kbd>{k}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
        <p className="help-foot">On macOS use ⌘ instead of Ctrl.</p>
      </div>
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}
