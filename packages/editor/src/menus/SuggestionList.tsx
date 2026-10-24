import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from 'react'

export interface ListEntry {
  key: string
  label: ReactNode
  desc?: string
  icon?: ReactNode
  hint?: string
  rich?: boolean
}

export interface SuggestionListProps {
  caption: string
  empty: string
  entries: ListEntry[]
  onPick: (index: number) => void
}

export interface SuggestionListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

/** The keyboard-driven list shown by the `/`, `[[` and `((` menus. */
export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(function SuggestionList(
  { caption, empty, entries, onPick },
  ref,
) {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [entries])

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!entries.length) return false
      if (e.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % entries.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + entries.length) % entries.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        onPick(index)
        return true
      }
      return false
    },
  }))

  return (
    <div className="menu-list">
      <div className="menu-caption">{caption}</div>
      {entries.map((it, i) => (
        <button
          key={it.key}
          className={`menu-item ${it.rich ? 'rich' : ''} ${i === index ? 'active' : ''}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
        >
          {it.rich ? <span className="menu-tile">{it.icon}</span> : <span className="menu-icon">{it.icon}</span>}
          {it.rich ? (
            <span className="menu-text">
              <strong>{it.label}</strong>
              {it.desc && <small>{it.desc}</small>}
            </span>
          ) : (
            <span className="menu-label">{it.label}</span>
          )}
          {it.hint && <kbd className="menu-hint">{it.hint}</kbd>}
        </button>
      ))}
      {entries.length === 0 && <div className="menu-empty">{empty}</div>}
    </div>
  )
})
