import type { CalloutLook } from '@brainwaves/editor'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Popover } from '../components/Popover'
import { getState, setState, useApp } from '../state/store'

/** Colours that read well on dark and light themes. '' is the theme's accent. */
export const CALLOUT_COLORS: [string, string][] = [
  ['', 'Accent'],
  ['#8b8f98', 'Gray'],
  ['#4f8fd8', 'Blue'],
  ['#2fb2a6', 'Teal'],
  ['#4fae6f', 'Green'],
  ['#e3b341', 'Yellow'],
  ['#e08a3c', 'Orange'],
  ['#e05a55', 'Red'],
  ['#d76da8', 'Pink'],
  ['#9a6dd7', 'Purple'],
]

/** Ready-made looks: an icon with a colour. */
export const CALLOUT_PRESETS: (CalloutLook & { name: string })[] = [
  { name: 'Note', icon: '📝', color: '#8b8f98', variant: 'bar' },
  { name: 'Info', icon: 'ℹ️', color: '#4f8fd8', variant: 'soft' },
  { name: 'Tip', icon: '💡', color: '#4fae6f', variant: 'soft' },
  { name: 'Warning', icon: '⚠️', color: '#e3b341', variant: 'soft' },
  { name: 'Danger', icon: '🔥', color: '#e05a55', variant: 'soft' },
  { name: 'Quote', icon: '💬', color: '#9a6dd7', variant: 'bar' },
]

const VARIANTS: [string, string][] = [
  ['soft', 'Soft'],
  ['outline', 'Outline'],
  ['bar', 'Bar'],
  ['solid', 'Solid'],
]

interface Pending {
  x: number
  y: number
  top: number
  current: CalloutLook
  apply: (patch: Partial<CalloutLook>) => void
}

let open: ((p: Pending | null) => void) | null = null

/** For `EditorHost.pickCalloutStyle`. */
export function pickCalloutStyle(anchor: DOMRect, current: CalloutLook, apply: (patch: Partial<CalloutLook>) => void) {
  open?.({ x: anchor.left, y: anchor.bottom, top: anchor.top, current, apply })
}

/** Mounted once (App): the menu itself. */
export function CalloutStyleMenu() {
  const [p, setP] = useState<Pending | null>(null)
  open = setP
  if (!p) return null
  return <Menu key={`${p.x},${p.y}`} p={p} close={() => setP(null)} />
}

function Swatch({ color, on, onClick, label }: { color: string; on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`co-swatch ${on ? 'on' : ''}`} style={{ background: color || 'var(--accent)' }} title={label} aria-label={label} onClick={onClick}>
      {on && <Check size={12} />}
    </button>
  )
}

function Menu({ p, close }: { p: Pending; close: () => void }) {
  const [look, setLook] = useState<CalloutLook>(p.current)
  const saved = useApp((s) => s.calloutStyles)
  // Changes show at once; closing keeps them.
  const apply = (patch: Partial<CalloutLook>) => {
    setLook((l) => ({ ...l, ...patch }))
    p.apply(patch)
  }
  const custom = look.color && !CALLOUT_COLORS.some(([c]) => c === look.color)
  return (
    <Popover x={p.x} y={p.y} anchorTop={p.top} onClose={close} className="co-menu">
      <div className="co-section">Looks</div>
      <div className="co-presets">
        {[...CALLOUT_PRESETS, ...saved].map((s) => (
          <button key={s.name} className="co-preset" onClick={() => apply({ icon: s.icon, color: s.color, variant: s.variant })} title={s.name}>
            <span className={`co-chip co-${s.variant}`} style={{ ['--co' as string]: s.color || 'var(--accent)' }}>
              {s.icon}
            </span>
            {s.name}
            {saved.includes(s as never) && (
              <span
                className="co-del"
                role="button"
                title="Forget this style"
                onClick={(e) => {
                  e.stopPropagation()
                  setState({ calloutStyles: getState().calloutStyles.filter((x) => x.name !== s.name) })
                }}
              >
                <Trash2 size={11} />
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="co-section">Colour</div>
      <div className="co-swatches">
        {CALLOUT_COLORS.map(([c, label]) => (
          <Swatch key={c || 'accent'} color={c} label={label} on={look.color === c} onClick={() => apply({ color: c })} />
        ))}
        <label className={`co-swatch co-pick ${custom ? 'on' : ''}`} title="Any colour" style={custom ? { background: look.color } : undefined}>
          <input type="color" value={look.color || '#8b5cf6'} onChange={(e) => apply({ color: e.target.value })} />
          {!custom && <Plus size={12} />}
        </label>
      </div>
      <div className="co-section">Style</div>
      <div className="co-variants">
        {VARIANTS.map(([v, label]) => (
          <button key={v} className={look.variant === v ? 'on' : ''} onClick={() => apply({ variant: v })}>
            <span className={`co-chip co-${v}`} style={{ ['--co' as string]: look.color || 'var(--accent)' }} />
            {label}
          </button>
        ))}
      </div>
      <button
        className="co-save"
        onClick={() => {
          const name = prompt('Name this callout style', '')?.trim()
          if (!name) return
          const rest = getState().calloutStyles.filter((x) => x.name.toLowerCase() !== name.toLowerCase())
          setState({ calloutStyles: [...rest, { name, icon: look.icon, color: look.color, variant: look.variant }] })
        }}
      >
        <Plus size={13} /> Save as a style
      </button>
    </Popover>
  )
}
