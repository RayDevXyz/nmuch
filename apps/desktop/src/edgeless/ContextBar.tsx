import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Blend,
  Bold,
  Circle,
  Copy,
  Diamond,
  FileText,
  Group,
  Italic,
  Layers,
  Lock,
  Minus,
  Plus,
  RotateCw,
  Square,
  SquareArrowOutUpRight,
  StretchHorizontal,
  StretchVertical,
  Trash2,
  Underline,
  Ungroup,
  Unlock,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { canRotate, colorOf, COLORS, FONTS, type CanvasNote, type Element, type FontFamily, type ShapeKind } from './model'

/**
 * The bar across the top of the canvas: what you can do with the selection. It changes with
 * what's selected, like a design tool's: colors and borders for shapes, the font for text,
 * transparency, the stacking order and alignment, grouping, locking.
 */

export type Order = 'front' | 'back' | 'forward' | 'backward'
export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

interface Props {
  items: Element[]
  note?: CanvasNote
  /** Set fields on every selected element they apply to. */
  onPatch: (patch: Record<string, unknown>) => void
  onOrder: (o: Order) => void
  onAlign: (a: Align) => void
  onDistribute: (axis: 'x' | 'y') => void
  onGroup: () => void
  onUngroup: () => void
  onLock: (locked: boolean) => void
  onDuplicate: () => void
  onDelete: () => void
  onDisplay: (d: 'both' | 'edgeless') => void
  onOpenPage?: () => void
  /** Room kept free on the left (the side panel). */
  left: number
}

const EXTRA = ['#000000', '#ffffff', '#64748b', '#0ea5e9', '#14b8a6', '#84cc16', '#f43f5e', '#c9a45c']

export function ContextBar(p: Props) {
  const { items } = p
  const [menu, setMenu] = useState<string | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  // A click elsewhere closes an open menu.
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => !bar.current?.contains(e.target as Node) && setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])
  const one = items.length === 1 ? items[0] : null
  const of = (...t: Element['type'][]) => items.filter((i) => t.includes(i.type))
  const shapes = of('shape')
  const texty = of('shape', 'text')
  const first = <K extends string>(k: K): unknown => (items.find((i) => k in i) as Record<string, unknown> | undefined)?.[k]
  const locked = items.length > 0 && items.every((i) => i.locked)
  const grouped = items.some((i) => i.group)
  const toggle = (m: string) => setMenu((x) => (x === m ? null : m))
  const fontSize = Number(first('fontSize') ?? (texty[0]?.type === 'text' ? 20 : 14))

  if (!items.length && p.note)
    return (
      <div className="cv-context" ref={bar} style={{ left: `calc(50% + ${p.left / 2}px)`, maxWidth: `calc(100% - ${p.left + 24}px)` }} onPointerDown={(e) => e.stopPropagation()}>
        <span className="cv-context-label">Note</span>
        <button className={`cv-doc-toggle ${p.note.display === 'both' ? 'on' : ''}`} onClick={() => p.onDisplay(p.note!.display === 'both' ? 'edgeless' : 'both')}>
          <FileText size={13} /> {p.note.display === 'both' ? 'In document' : 'Canvas only'}
        </button>
        <span className="cv-sep" />
        <Btn label="Delete (Del)" onClick={p.onDelete}>
          <Trash2 size={15} />
        </Btn>
      </div>
    )
  if (!items.length) return null

  return (
    <div className="cv-context" ref={bar} style={{ left: `calc(50% + ${p.left / 2}px)`, maxWidth: `calc(100% - ${p.left + 24}px)` }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {locked ? (
        <span className="cv-context-label">
          <Lock size={13} /> Locked
        </span>
      ) : (
        <>
          {/* ---- colors */}
          {of('shape', 'frame').length > 0 && (
            <Swatch label={shapes.length ? 'Fill' : 'Background'} value={first('fill') as string | undefined} open={menu === 'fill'} onOpen={() => toggle('fill')} onPick={(c) => p.onPatch({ fill: c })} none />
          )}
          {shapes.length > 0 && (
            <Swatch label="Border" ring value={first('stroke') as string | undefined} open={menu === 'stroke'} onOpen={() => toggle('stroke')} onPick={(c) => p.onPatch({ stroke: c })} none>
              <div className="cv-menu-row">
                {[0, 1, 2, 4, 8].map((w) => (
                  <button key={w} className={`cv-mini ${Number(first('strokeWidth') ?? 2) === w ? 'on' : ''}`} onClick={() => p.onPatch({ strokeWidth: w })} title={w ? `${w} px` : 'No border'}>
                    {w || '—'}
                  </button>
                ))}
              </div>
            </Swatch>
          )}
          {of('connector').length > 0 && <Swatch label="Line" value={first('stroke') as string | undefined} open={menu === 'line'} onOpen={() => toggle('line')} onPick={(c) => p.onPatch({ stroke: c })} />}
          {of('text', 'pin', 'token').length + shapes.length > 0 && (
            <Swatch label={of('pin', 'token').length && !texty.length ? 'Color' : 'Text color'} text value={first('color') as string | undefined} open={menu === 'color'} onOpen={() => toggle('color')} onPick={(c) => p.onPatch({ color: c })} />
          )}

          {/* ---- text */}
          {texty.length > 0 && (
            <>
              <span className="cv-sep" />
              <select className="cv-font" value={(first('fontFamily') as string) ?? 'sans'} onChange={(e) => p.onPatch({ fontFamily: e.target.value as FontFamily })} title="Font">
                {Object.entries(FONTS).map(([k, f]) => (
                  <option key={k} value={k} style={{ fontFamily: f.css }}>
                    {f.label}
                  </option>
                ))}
              </select>
              <div className="cv-size">
                <button aria-label="Smaller" onClick={() => p.onPatch({ fontSize: Math.max(6, fontSize - (fontSize > 24 ? 4 : 2)) })}>
                  <Minus size={12} />
                </button>
                <input
                  aria-label="Font size"
                  value={fontSize}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (n >= 6 && n <= 400) p.onPatch({ fontSize: n })
                  }}
                />
                <button aria-label="Bigger" onClick={() => p.onPatch({ fontSize: Math.min(400, fontSize + (fontSize >= 24 ? 4 : 2)) })}>
                  <Plus size={12} />
                </button>
              </div>
              <Btn label="Bold" on={!!first('bold')} onClick={() => p.onPatch({ bold: !first('bold') || undefined })}>
                <Bold size={15} />
              </Btn>
              <Btn label="Italic" on={!!first('italic')} onClick={() => p.onPatch({ italic: !first('italic') || undefined })}>
                <Italic size={15} />
              </Btn>
              <Btn label="Underline" on={!!first('underline')} onClick={() => p.onPatch({ underline: !first('underline') || undefined })}>
                <Underline size={15} />
              </Btn>
              {(() => {
                const cur = (first('align') as string) ?? (shapes.length ? 'center' : 'left')
                const next = cur === 'left' ? 'center' : cur === 'center' ? 'right' : 'left'
                const Icon = cur === 'left' ? AlignLeft : cur === 'center' ? AlignCenter : AlignRight
                return (
                  <Btn label={`Align text (${cur})`} onClick={() => p.onPatch({ align: next })}>
                    <Icon size={15} />
                  </Btn>
                )
              })()}
            </>
          )}

          {/* ---- shape */}
          {shapes.length > 0 && (
            <>
              <span className="cv-sep" />
              {(
                [
                  ['rect', <Square size={14} key="r" />],
                  ['ellipse', <Circle size={14} key="e" />],
                  ['diamond', <Diamond size={14} key="d" />],
                ] as [ShapeKind, React.ReactNode][]
              ).map(([k, icon]) => (
                <Btn key={k} label={k} on={one?.type === 'shape' && one.shape === k} onClick={() => p.onPatch({ shape: k })}>
                  {icon}
                </Btn>
              ))}
            </>
          )}

          <span className="cv-sep" />
          {/* ---- transparency */}
          <div className="cv-menu-anchor">
            <Btn label="Transparency" on={menu === 'opacity'} onClick={() => toggle('opacity')}>
              <Blend size={15} />
            </Btn>
            {menu === 'opacity' && (
              <div className="cv-menu">
                <label className="cv-menu-label">Transparency</label>
                <div className="cv-menu-row">
                  <input type="range" min={5} max={100} value={Math.round(Number(first('opacity') ?? 1) * 100)} onChange={(e) => p.onPatch({ opacity: Number(e.target.value) >= 100 ? undefined : Number(e.target.value) / 100 })} />
                  <span className="cv-menu-value">{Math.round(Number(first('opacity') ?? 1) * 100)}%</span>
                </div>
              </div>
            )}
          </div>
          {/* ---- position */}
          <div className="cv-menu-anchor">
            <button className={`cv-text-btn ${menu === 'position' ? 'on' : ''}`} onClick={() => toggle('position')}>
              <Layers size={14} /> Position
            </button>
            {menu === 'position' && (
              <div className="cv-menu wide">
                <label className="cv-menu-label">Layer</label>
                <div className="cv-menu-grid">
                  <MenuBtn icon={<ArrowUp size={14} />} label="Forward" hint="Ctrl ]" onClick={() => p.onOrder('forward')} />
                  <MenuBtn icon={<ArrowDown size={14} />} label="Backward" hint="Ctrl [" onClick={() => p.onOrder('backward')} />
                  <MenuBtn icon={<ArrowUpToLine size={14} />} label="To front" hint="Ctrl Shift ]" onClick={() => p.onOrder('front')} />
                  <MenuBtn icon={<ArrowDownToLine size={14} />} label="To back" hint="Ctrl Shift [" onClick={() => p.onOrder('back')} />
                </div>
                {items.length > 1 && (
                  <>
                    <label className="cv-menu-label">Align</label>
                    <div className="cv-menu-grid">
                      <MenuBtn icon={<AlignStartVertical size={14} />} label="Left" onClick={() => p.onAlign('left')} />
                      <MenuBtn icon={<AlignStartHorizontal size={14} />} label="Top" onClick={() => p.onAlign('top')} />
                      <MenuBtn icon={<AlignCenterVertical size={14} />} label="Center" onClick={() => p.onAlign('center')} />
                      <MenuBtn icon={<AlignCenterHorizontal size={14} />} label="Middle" onClick={() => p.onAlign('middle')} />
                      <MenuBtn icon={<AlignEndVertical size={14} />} label="Right" onClick={() => p.onAlign('right')} />
                      <MenuBtn icon={<AlignEndHorizontal size={14} />} label="Bottom" onClick={() => p.onAlign('bottom')} />
                    </div>
                  </>
                )}
                {items.length > 2 && (
                  <>
                    <label className="cv-menu-label">Spacing</label>
                    <div className="cv-menu-grid">
                      <MenuBtn icon={<StretchHorizontal size={14} />} label="Even across" onClick={() => p.onDistribute('x')} />
                      <MenuBtn icon={<StretchVertical size={14} />} label="Even down" onClick={() => p.onDistribute('y')} />
                    </div>
                  </>
                )}
                {one && canRotate(one) && (
                  <>
                    <label className="cv-menu-label">Rotation</label>
                    <div className="cv-menu-row">
                      <RotateCw size={14} />
                      <input
                        className="cv-menu-input"
                        type="number"
                        value={Math.round(one.rotate ?? 0)}
                        onChange={(e) => {
                          const n = ((Number(e.target.value) % 360) + 360) % 360
                          p.onPatch({ rotate: n || undefined })
                        }}
                      />
                      °
                      <button className="cv-mini" onClick={() => p.onPatch({ rotate: undefined })}>
                        Reset
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {items.length > 1 && !grouped && (
            <Btn label="Group (Ctrl G)" onClick={p.onGroup}>
              <Group size={15} />
            </Btn>
          )}
          {grouped && (
            <Btn label="Ungroup (Ctrl Shift G)" onClick={p.onUngroup}>
              <Ungroup size={15} />
            </Btn>
          )}
        </>
      )}
      {p.onOpenPage && (
        <button className="cv-doc-toggle on" title="Open the page this pin marks" onClick={p.onOpenPage}>
          <SquareArrowOutUpRight size={13} /> Open page
        </button>
      )}
      <Btn label={locked ? 'Unlock (Alt Shift L)' : 'Lock (Alt Shift L)'} on={locked} onClick={() => p.onLock(!locked)}>
        {locked ? <Lock size={15} /> : <Unlock size={15} />}
      </Btn>
      {!locked && (
        <>
          <Btn label="Duplicate (Ctrl D)" onClick={p.onDuplicate}>
            <Copy size={15} />
          </Btn>
          <Btn label="Delete (Del)" danger onClick={p.onDelete}>
            <Trash2 size={15} />
          </Btn>
        </>
      )}
    </div>
  )
}

function Btn({ label, on, danger, onClick, children }: { label: string; on?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`cv-cbtn ${on ? 'on' : ''} ${danger ? 'danger' : ''}`} title={label} aria-label={label} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

function MenuBtn({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button className="cv-menu-btn" onClick={onClick}>
      {icon} <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
}

/** A color button and its palette: the named colors, a few more, and any color. */
function Swatch({
  label,
  value,
  open,
  onOpen,
  onPick,
  none,
  ring,
  text,
  children,
}: {
  label: string
  value?: string
  open: boolean
  onOpen: () => void
  onPick: (c: string) => void
  none?: boolean
  ring?: boolean
  text?: boolean
  children?: React.ReactNode
}) {
  const shown = value === 'none' ? 'transparent' : colorOf(value, text ? 'var(--foreground)' : 'var(--muted-foreground)')
  return (
    <div className="cv-menu-anchor">
      <button className={`cv-swatch-btn ${open ? 'on' : ''}`} title={label} aria-label={label} onClick={onOpen}>
        {text ? (
          <span className="cv-swatch-text" style={{ borderBottomColor: shown }}>
            A
          </span>
        ) : (
          <span className={`cv-swatch-dot ${ring ? 'ring' : ''} ${value === 'none' ? 'none' : ''}`} style={ring ? { borderColor: shown } : { background: shown }} />
        )}
      </button>
      {open && (
        <div className="cv-menu">
          <label className="cv-menu-label">{label}</label>
          <div className="cv-palette">
            {none && <button className={`cv-swatch none ${value === 'none' ? 'active' : ''}`} title="None" aria-label="None" onClick={() => onPick('none')} />}
            {Object.entries(COLORS).map(([name, hex]) => (
              <button key={name} className={`cv-swatch ${value === name ? 'active' : ''}`} style={{ background: hex }} title={name} aria-label={`Color ${name}`} onClick={() => onPick(name)} />
            ))}
            {EXTRA.map((hex) => (
              <button key={hex} className={`cv-swatch ${value === hex ? 'active' : ''}`} style={{ background: hex }} title={hex} aria-label={`Color ${hex}`} onClick={() => onPick(hex)} />
            ))}
            <label className="cv-swatch custom" title="Any color">
              <input type="color" value={value && value.startsWith('#') ? value : '#4f8fd8'} onChange={(e) => onPick(e.target.value)} />
              <Plus size={12} />
            </label>
          </div>
          {children}
        </div>
      )}
    </div>
  )
}
