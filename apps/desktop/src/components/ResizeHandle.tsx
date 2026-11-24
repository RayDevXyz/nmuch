import { useRef } from 'react'

/**
 * A thin strip on a panel's inner edge: drag it to change the panel's width, double-click to put
 * it back. `edge` is the side of the panel the strip sits on ("right" for the left sidebar).
 */
export function ResizeHandle({
  edge,
  width,
  min,
  max,
  initial,
  onWidth,
  label,
}: {
  edge: 'left' | 'right'
  width: number
  min: number
  max: number
  initial: number
  onWidth: (w: number) => void
  label: string
}) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(max, w)))
  return (
    <div
      className={`resize-handle ${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: width }
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const dx = e.clientX - start.current.x
        onWidth(clamp(start.current.w + (edge === 'right' ? dx : -dx)))
      }}
      onPointerUp={() => {
        start.current = null
        document.body.classList.remove('resizing')
      }}
      onPointerCancel={() => {
        start.current = null
        document.body.classList.remove('resizing')
      }}
      onDoubleClick={() => onWidth(initial)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft'
        const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight'
        if (e.key === grow) onWidth(clamp(width + step))
        else if (e.key === shrink) onWidth(clamp(width - step))
        else return
        e.preventDefault()
      }}
    />
  )
}
