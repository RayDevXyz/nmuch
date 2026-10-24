import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
}

export function Popover({ x, y, anchorTop, onClose, children, className, keepFocus }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
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
    setPos({ left, top, ready: true })
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
    <div
      ref={ref}
      className={`popover ${className ?? ''}`}
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
    >
      {children}
    </div>,
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
