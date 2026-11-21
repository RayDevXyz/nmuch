import { forwardRef, Fragment, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'

export interface ListEntry {
  key: string
  label: ReactNode
  desc?: string
  icon?: ReactNode
  hint?: string
  rich?: boolean
  /** With `tabs`: the tab it's listed under. */
  group?: string
}

export interface SuggestionListProps {
  caption: string
  empty: string
  entries: ListEntry[]
  onPick: (index: number) => void
  /** Show a tab per group (plus "All"); ← → switch tabs. */
  tabs?: boolean
}

export interface SuggestionListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

const ALL = 'All'
/** The tab last used, so the menu opens where you were (e.g. on D&D while running a game). */
let lastTab = ALL

/** The keyboard-driven list shown by the `/`, `[[` and `((` menus. */
export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(function SuggestionList(
  { caption, empty, entries, onPick, tabs = false },
  ref,
) {
  const [index, setIndex] = useState(0)
  const [tab, setTabState] = useState(() => (tabs ? lastTab : ALL))
  const setTab = (t: string) => {
    lastTab = t
    setTabState(t)
    setIndex(0)
  }
  const groups = useMemo(() => {
    if (!tabs) return []
    const seen: string[] = []
    for (const e of entries) if (e.group && !seen.includes(e.group)) seen.push(e.group)
    return seen
  }, [entries, tabs])
  // A tab with nothing matching (or one that's gone) shows everything instead.
  const inTab = (e: ListEntry) => tab === ALL || e.group === tab
  const active = tabs && tab !== ALL && entries.some(inTab) ? tab : ALL
  // Indices into `entries` of what's shown, in display order (grouped under "All").
  const shown = useMemo(() => {
    const idx = entries.map((_, i) => i)
    if (!tabs) return idx
    if (active !== ALL) return idx.filter((i) => entries[i].group === active)
    return groups.flatMap((g) => idx.filter((i) => entries[i].group === g))
  }, [entries, tabs, active, groups])
  useEffect(() => setIndex(0), [entries])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [index, active])

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (tabs && groups.length > 1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const all = [ALL, ...groups]
        const i = all.indexOf(active)
        setTab(all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length])
        return true
      }
      if (!shown.length) return false
      if (e.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % shown.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + shown.length) % shown.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        onPick(shown[Math.min(index, shown.length - 1)])
        return true
      }
      return false
    },
  }))

  return (
    <div className="menu-list" ref={list}>
      {tabs && groups.length > 1 ? (
        <div className="menu-tabs" role="tablist" title="← → to switch">
          {[ALL, ...groups].map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={active === g}
              className={`menu-tab ${active === g ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(g)}
            >
              {g}
            </button>
          ))}
        </div>
      ) : (
        <div className="menu-caption">{caption}</div>
      )}
      {shown.map((i, n) => {
        const it = entries[i]
        const heading = tabs && active === ALL && groups.length > 1 && (n === 0 || entries[shown[n - 1]].group !== it.group)
        return (
          <Fragment key={it.key}>
            {heading && <div className="menu-caption">{it.group}</div>}
            <button
              className={`menu-item ${it.rich ? 'rich' : ''} ${n === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(n)}
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
          </Fragment>
        )
      })}
      {shown.length === 0 && <div className="menu-empty">{empty}</div>}
    </div>
  )
})
