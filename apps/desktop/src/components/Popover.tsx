import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNarrow } from '../mobile/narrow'

interface Props {
  x: number
  y: number
  /** top edge of the anchor, used to flip the popover upwards near the bottom */
  anchorTop?: number
  onClose: () => void
  children: ReactNode
  className?: string
  /** keep focus where it is (editor menus) */
  keepFocus?: boolean
  /** stay next to the anchor on phones too, instead of becoming a bottom sheet */
  anchored?: boolean
}

export function Popover({ x, y, anchorTop, onClose, children, className, keepFocus, anchored }: Props) {
  // Phones: menus and panels slide up from the bottom, where a thumb can reach them.
  const sheet = useNarrow() && !anchored && !keepFocus
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let left = Math.min(x, vw - r.width - 8)
      left = Math.max(8, left)
      let top = y + 4
      if (top + r.height > vh - 8) {
        const up = (anchorTop ?? y) - r.height - 4
        top = up > 8 ? up : Math.max(8, vh - r.height - 8)
      }
      setPos((p) => (p.left === left && p.top === top && p.ready ? p : { left, top, ready: true }))
    }
    place()
    // Content that loads late (a path, a list) changes the size: place it again.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [x, y, anchorTop])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !keepFocus) {
        e.preventDefault()
        onClose()
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0)
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose, keepFocus])

  return createPortal(
    <>
      {sheet && <div className="sheet-scrim" aria-hidden />}
      <div
        ref={ref}
        className={`popover ${sheet ? 'sheet' : ''} ${className ?? ''}`}
        style={sheet ? undefined : { left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
        onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      >
        {sheet && <div className="sheet-grip" aria-hidden />}
        {children}
      </div>
    </>,
    document.querySelector('.workspace') ?? document.body,
  )
}

export interface MenuEntry {
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  onSelect: () => void
}

export function MenuList({ items, onDone }: { items: (MenuEntry | 'sep')[]; onDone: () => void }) {
  return (
    <div className="menu-list" role="menu">
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${it.danger ? 'danger' : ''}`}
            onClick={() => {
              onDone()
              it.onSelect()
            }}
          >
            {it.icon && <span className="menu-icon">{it.icon}</span>}
            <span className="menu-label">{it.label}</span>
            {it.hint && <kbd className="menu-hint">{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  )
}
