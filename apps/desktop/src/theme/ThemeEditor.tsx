import { Check, ClipboardPaste, Copy, Download, Moon, Palette, Plus, RotateCcw, Sun, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { getState, setState, toast, useApp } from '../state/store'
import {
  activeTheme,
  BUILTIN,
  checks,
  exportTheme,
  FONT_STACKS,
  MONO_STACKS,
  newThemeId,
  parseTheme,
  type Mode,
  type ThemeColors,
  type ThemeDef,
} from './themes'

/**
 * The theme editor: a drawer on the right that restyles the whole app as you edit, so the app
 * itself is the preview. Pick a theme for each mode (dark, light), or make your own from any of
 * them; editing a built-in theme makes your own copy first.
 */

export function ThemeEditorHost() {
  const open = useApp((s) => s.themeEditor)
  return open ? <ThemeEditor /> : null
}

const GROUPS: { title: string; keys: [keyof ThemeColors, string, string][] }[] = [
  {
    title: 'Surfaces',
    keys: [
      ['appBg', 'Window', 'Behind everything'],
      ['panel', 'Panels', 'Top bar, sidebars, menus'],
      ['panel2', 'Raised', 'Inputs, chips, cards'],
      ['hover', 'Hover', 'Under the pointer, selected rows'],
      ['line', 'Borders', 'Lines between things'],
      ['editorBg', 'Page', 'Where you write'],
      ['codeBg', 'Code blocks', 'Code and quotes'],
    ],
  },
  {
    title: 'Text',
    keys: [
      ['foreground', 'Text', 'Body and headings'],
      ['muted', 'Secondary', 'Labels, descriptions'],
      ['faint', 'Faint', 'Hints, placeholders'],
    ],
  },
  {
    title: 'Accent and status',
    keys: [
      ['accent', 'Accent', 'Buttons, links, selection'],
      ['warm', 'Warm', 'Highlights, warnings'],
      ['folder', 'Folders', 'Folder icons'],
      ['ok', 'Success', 'Saved, done'],
      ['danger', 'Danger', 'Errors, delete'],
    ],
  },
]

const ACCENTS = ['#d7b9ff', '#7aa2ff', '#5ec4c4', '#8fd19e', '#e3c27a', '#ff9a62', '#ff7f8e', '#e879f9', '#6842bd', '#0b7fab', '#2f8a57', '#b33a2a']

function ThemeEditor() {
  const mode = useApp((s) => s.theme)
  const themes = useApp((s) => s.themes)
  const themeFor = useApp((s) => s.themeFor)
  const current = activeTheme(mode, themeFor, themes)
  const file = useRef<HTMLInputElement>(null)
  const list = [...BUILTIN, ...themes].filter((t) => t.base === mode)
  const base = BUILTIN.find((b) => b.id === mode)!

  const use = (t: ThemeDef) => setState((s) => ({ theme: t.base, themeFor: { ...s.themeFor, [t.base]: t.id } }))
  const addTheme = (t: Omit<ThemeDef, 'id'>): ThemeDef => {
    const made: ThemeDef = { ...t, id: newThemeId(), builtin: undefined }
    setState((s) => ({ themes: [...s.themes, made], theme: made.base, themeFor: { ...s.themeFor, [made.base]: made.id } }))
    return made
  }
  /** Change the theme in use; a built-in one is copied first. */
  const change = (fn: (t: ThemeDef) => ThemeDef) => {
    const t = activeTheme(getState().theme, getState().themeFor, getState().themes)
    if (t.builtin) {
      const copy = addTheme({ ...fn({ ...t, colors: { ...t.colors }, fonts: { ...t.fonts } }), name: `${t.name} (mine)` })
      toast(`Made your own copy: ${copy.name}`)
      return
    }
    setState((s) => ({ themes: s.themes.map((x) => (x.id === t.id ? fn(x) : x)) }))
  }
  const setColor = (k: keyof ThemeColors, v: string) => change((t) => ({ ...t, colors: { ...t.colors, [k]: v } }))
  const remove = () => {
    if (current.builtin || !confirm(`Delete the theme “${current.name}”?`)) return
    setState((s) => ({ themes: s.themes.filter((x) => x.id !== current.id), themeFor: { ...s.themeFor, [current.base]: undefined } }))
  }
  const importText = (text: string) => {
    let parsed: ReturnType<typeof parseTheme> = null
    try {
      parsed = parseTheme(JSON.parse(text))
    } catch {
      /* not JSON */
    }
    if (!parsed) return toast("That isn't a BrainWaves theme")
    const t = addTheme(parsed)
    toast(`Imported ${t.name}`)
  }
  const download = () => {
    const blob = new Blob([exportTheme(current)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${current.name.replace(/[^\w -]+/g, '').trim() || 'theme'}.bwtheme.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <aside className="te" aria-label="Theme editor" onKeyDown={(e) => e.key === 'Escape' && setState({ themeEditor: false })}>
      <header className="te-head">
        <span>
          <Palette size={16} /> Theme editor
        </span>
        <button className="icon-button" aria-label="Close" title="Close" onClick={() => setState({ themeEditor: false })}>
          <X size={16} />
        </button>
      </header>
      <div className="te-body">
        <div className="te-modes" role="tablist">
          {(['dark', 'light'] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setState({ theme: m })}>
              {m === 'dark' ? <Moon size={13} /> : <Sun size={13} />} {m === 'dark' ? 'Dark mode' : 'Light mode'}
            </button>
          ))}
        </div>
        <p className="te-hint">Each mode keeps its own theme; the dark/light switch moves between them.</p>

        <div className="te-themes">
          {list.map((t) => (
            <button key={t.id} className={`te-card ${t.id === current.id ? 'on' : ''}`} onClick={() => use(t)} title={t.builtin ? 'Built-in theme' : 'Your theme'}>
              <span className="te-card-preview" style={{ background: t.colors.appBg }}>
                <i style={{ background: t.colors.panel, borderColor: t.colors.line }} />
                <i style={{ background: t.colors.editorBg, borderColor: t.colors.line }}>
                  <b style={{ background: t.colors.foreground }} />
                  <b style={{ background: t.colors.muted, width: '60%' }} />
                  <b style={{ background: t.colors.accent, width: '35%' }} />
                </i>
              </span>
              <span className="te-card-name">
                {t.id === current.id && <Check size={11} />} {t.name}
              </span>
            </button>
          ))}
          <button className="te-card add" onClick={() => addTheme({ ...current, name: `${current.name} copy`, builtin: undefined, colors: { ...current.colors }, fonts: { ...current.fonts } })} title="A new theme, starting from this one">
            <Plus size={18} />
            <span className="te-card-name">New from this</span>
          </button>
        </div>

        <section className="te-sec">
          {current.builtin ? (
            <p className="te-note">
              <b>{current.name}</b> is built in: changing anything makes your own copy.
            </p>
          ) : (
            <label className="te-name">
              Name
              <input value={current.name} maxLength={40} onChange={(e) => change((t) => ({ ...t, name: e.target.value }))} />
            </label>
          )}
          <div className="te-actions">
            <button onClick={download} title="Save the theme as a file to share">
              <Download size={13} /> Export
            </button>
            <button onClick={() => void navigator.clipboard.writeText(exportTheme(current)).then(() => toast('Theme copied'), () => toast("Couldn't copy"))} title="Copy the theme's file to the clipboard">
              <Copy size={13} /> Copy
            </button>
            <button onClick={() => file.current?.click()} title="Import a theme file">
              <Upload size={13} /> Import
            </button>
            <button onClick={() => void navigator.clipboard.readText().then(importText, () => toast("Couldn't read the clipboard"))} title="Import a theme you copied">
              <ClipboardPaste size={13} /> Paste
            </button>
            {!current.builtin && (
              <button className="danger" onClick={remove} title="Delete this theme">
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void f.text().then(importText)
            }}
          />
        </section>

        <section className="te-sec">
          <h3>Accent</h3>
          <div className="te-accents">
            {ACCENTS.map((c) => (
              <button key={c} className={`te-accent ${current.colors.accent.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Accent ${c}`} onClick={() => setColor('accent', c)} />
            ))}
          </div>
          <div className="te-sample">
            <button className="te-sample-primary">Primary</button>
            <button className="te-sample-secondary">Secondary</button>
            <span className="te-sample-chip">#tag</span>
            <a className="te-sample-link">A link</a>
            <code>code</code>
          </div>
        </section>

        {GROUPS.map((g) => (
          <section className="te-sec" key={g.title}>
            <h3>{g.title}</h3>
            {g.keys.map(([k, label, hint]) => (
              <ColorRow key={k} label={label} hint={hint} value={current.colors[k]} original={(BUILTIN.find((b) => b.id === current.id) ?? base).colors[k]} onChange={(v) => setColor(k, v)} />
            ))}
          </section>
        ))}

        <section className="te-sec">
          <h3>Fonts</h3>
          <FontRow label="Interface and writing" stacks={FONT_STACKS} value={current.fonts.sans} onChange={(v) => change((t) => ({ ...t, fonts: { ...t.fonts, sans: v } }))} />
          <FontRow label="Code" stacks={MONO_STACKS} value={current.fonts.mono} onChange={(v) => change((t) => ({ ...t, fonts: { ...t.fonts, mono: v } }))} />
          <p className="te-hint">“Another font…” uses a font installed on this computer, by its name.</p>
        </section>

        <section className="te-sec">
          <h3>Readability</h3>
          {checks(current.colors).map((c) => {
            const ok = c.ratio >= c.need
            return (
              <div key={c.label} className={`te-check ${ok ? 'ok' : 'low'}`}>
                <span className="te-check-sample" style={{ color: c.fg, background: c.bg }}>
                  Aa
                </span>
                <span className="te-check-label">{c.label}</span>
                <span className="te-check-ratio" title={`Needs ${c.need}:1 to read comfortably (WCAG AA)`}>
                  {c.ratio.toFixed(1)}:1 {ok ? '✓' : 'low'}
                </span>
              </div>
            )
          })}
        </section>

        {!current.builtin && (
          <button
            className="te-reset"
            onClick={() => {
              const from = BUILTIN.find((b) => b.id === current.base)!
              change((t) => ({ ...t, colors: { ...from.colors }, fonts: { ...from.fonts } }))
            }}
          >
            <RotateCcw size={13} /> Start over from {current.base === 'dark' ? 'Dark' : 'Light'}
          </button>
        )}
      </div>
    </aside>
  )
}

function ColorRow({ label, hint, value, original, onChange }: { label: string; hint: string; value: string; original: string; onChange: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  const changed = value.toLowerCase() !== original.toLowerCase()
  return (
    <div className="te-color">
      <label className="te-swatch" style={{ background: value }} title="Pick a color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      </label>
      <span className="te-color-label">
        {label}
        <small>{hint}</small>
      </span>
      <input
        className="te-hex"
        value={text ?? value}
        spellCheck={false}
        aria-label={`${label} (hex)`}
        onChange={(e) => {
          setText(e.target.value)
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase())
        }}
        onBlur={() => setText(null)}
      />
      <button className="te-undo" title={`Back to ${original}`} aria-label={`Reset ${label}`} style={{ visibility: changed ? 'visible' : 'hidden' }} onClick={() => onChange(original)}>
        <RotateCcw size={12} />
      </button>
    </div>
  )
}

function FontRow({ label, stacks, value, onChange }: { label: string; stacks: { id: string; label: string; css: string }[]; value: string; onChange: (v: string) => void }) {
  const known = stacks.some((s) => s.id === value)
  const [custom, setCustom] = useState(!known)
  return (
    <label className="te-font">
      {label}
      <select
        value={custom ? '__custom' : value}
        onChange={(e) => {
          if (e.target.value === '__custom') return setCustom(true)
          setCustom(false)
          onChange(e.target.value)
        }}
      >
        {stacks.map((s) => (
          <option key={s.id} value={s.id} style={{ fontFamily: s.css }}>
            {s.label}
          </option>
        ))}
        <option value="__custom">Another font…</option>
      </select>
      {custom && <input placeholder="Font name, e.g. Inter" defaultValue={known ? '' : value} onBlur={(e) => e.target.value.trim() && !/[;{}<>'"]/.test(e.target.value) && onChange(e.target.value.trim())} />}
    </label>
  )
}
