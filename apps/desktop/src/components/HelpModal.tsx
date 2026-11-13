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
      ['((', 'Link to a block'],
      ['/database', 'Table, board or gallery (rows are pages)'],
      ['/course', 'Course tracker: courses, lessons, progress'],
      ['Enter / Shift Enter', 'New block / line break'],
      ['Tab / Shift Tab', 'Indent / outdent list item'],
      ['Ctrl Alt 0–3', 'Text / Heading 1–3'],
      ['Ctrl Shift 7 8 9', 'Numbered / bullet / to-do'],
      ['Ctrl Shift B', 'Quote'],
      ['Ctrl Alt C', 'Code block'],
      ['Drag ⠿', 'Move block (click it for more)'],
      ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
    ],
  ],
  [
    'D&D',
    [
      ['/campaign', 'New campaign: NPCs, locations, factions, sessions, story beats, map'],
      ['/character', 'New character from your 5etools'],
      ['Ctrl Shift D', 'Compendium (set your 5etools address in its ⚙)'],
      ['/spell /monster /item', 'Put a 5e entry in the page as a card'],
      ['Plan an arc', 'Story beats from a template, on a campaign page'],
      ['World map: I / P', 'Image (the map) / pin a page on it'],
    ],
  ],
  [
    'Courses',
    [
      ['/course tracker', '1. Create Courses + Lessons'],
      ['Import folder', '2. On Courses: pick a folder of videos'],
      ['▶ in File', '3. Watch a lesson (marks it watched)'],
      ['Done', 'Tick lessons: course progress updates'],
      ['Folder changes', 'New files become lessons by themselves'],
      ['/course dashboard', 'Progress cards (after step 1)'],
      ['⚙ → Modules', 'See or remove course folders'],
    ],
  ],
  [
    'Canvas',
    [
      ['Ctrl Shift E', 'Switch document / canvas'],
      ['V / H', 'Select / pan (or hold Space)'],
      ['N / T', 'Note / text'],
      ['R / O / D', 'Rectangle / ellipse / diamond'],
      ['C', 'Connector: drag from item to item'],
      ['F', 'Frame (▶ in the toolbar presents them)'],
      ['Double-click', 'Edit text, or add text on empty space'],
      ['Wheel / Ctrl wheel', 'Pan / zoom'],
      ['Ctrl 1', 'Zoom to fit'],
      ['Ctrl D', 'Duplicate'],
      ['Arrows (Shift)', 'Nudge 1px (10px)'],
      ['Del', 'Delete selection'],
    ],
  ],
  [
    'Formatting',
    [
      ['Ctrl B / I / U', 'Bold / italic / underline'],
      ['Ctrl E', 'Inline code'],
      ['Ctrl Shift S', 'Strikethrough'],
      ['Select text', 'Toolbar (incl. link)'],
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
