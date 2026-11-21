/**
 * The app's themes: the two built-in looks (dark and light, as in `styles.css`), a few more
 * presets, and the user's own. A theme is a handful of colors and fonts; everything else (soft
 * borders, the accent's tints, text on the accent) is worked out from them, so a theme stays
 * consistent however it's edited.
 *
 * Each mode (dark, light) remembers which theme it uses, so the dark/light switch keeps working.
 */

export type Mode = 'dark' | 'light'

export interface ThemeColors {
  /** Behind everything (the window). */
  appBg: string
  /** Panels: the top bar, sidebars, menus. */
  panel: string
  /** Raised things on panels: inputs, chips, cards. */
  panel2: string
  hover: string
  line: string
  /** Where you write. */
  editorBg: string
  codeBg: string
  foreground: string
  muted: string
  faint: string
  accent: string
  warm: string
  folder: string
  ok: string
  danger: string
}

export interface ThemeDef {
  id: string
  name: string
  base: Mode
  colors: ThemeColors
  fonts: { sans: string; mono: string }
  /** Built-in themes can't be changed (customize makes a copy). */
  builtin?: boolean
}

export const FONT_STACKS: { id: string; label: string; css: string }[] = [
  { id: 'manrope', label: 'Manrope', css: "'Manrope Variable', 'Manrope', Inter, 'Segoe UI', system-ui, sans-serif" },
  { id: 'system', label: 'System', css: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" },
  { id: 'humanist', label: 'Humanist', css: "'Segoe UI', 'Gill Sans', 'Trebuchet MS', Candara, sans-serif" },
  { id: 'serif', label: 'Serif (EB Garamond)', css: "'EB Garamond', Georgia, 'Times New Roman', serif" },
  { id: 'classic', label: 'Classic (Cinzel)', css: "Cinzel, 'EB Garamond', Georgia, serif" },
  { id: 'mono', label: 'Monospace', css: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Consolas, monospace" },
]
export const MONO_STACKS: { id: string; label: string; css: string }[] = [
  { id: 'jetbrains', label: 'JetBrains Mono', css: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Consolas, monospace" },
  { id: 'system-mono', label: 'System monospace', css: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
]

const DARK: ThemeColors = {
  appBg: '#111214',
  panel: '#191a1d',
  panel2: '#24262b',
  hover: '#30323a',
  line: '#3b3e46',
  editorBg: '#141517',
  codeBg: '#1c1d21',
  foreground: '#f5f3ef',
  muted: '#b7b5bc',
  faint: '#7d7b84',
  accent: '#d7b9ff',
  warm: '#e6a55d',
  folder: '#d9a34d',
  ok: '#91c89b',
  danger: '#ff8a80',
}
const LIGHT: ThemeColors = {
  appBg: '#f3f1f7',
  panel: '#fbfafc',
  panel2: '#f0edf5',
  hover: '#e7e2ef',
  line: '#d5cfdf',
  editorBg: '#f8f7fa',
  codeBg: '#f1eef6',
  foreground: '#27232d',
  muted: '#625d6d',
  faint: '#9a95a3',
  accent: '#6842bd',
  warm: '#c27a2c',
  folder: '#c48a2c',
  ok: '#3f8a4c',
  danger: '#c63b30',
}
const FONTS = { sans: 'manrope', mono: 'jetbrains' }

export const BUILTIN: ThemeDef[] = [
  { id: 'dark', name: 'Dark', base: 'dark', colors: DARK, fonts: FONTS, builtin: true },
  { id: 'light', name: 'Light', base: 'light', colors: LIGHT, fonts: FONTS, builtin: true },
  {
    id: 'midnight',
    name: 'Midnight',
    base: 'dark',
    builtin: true,
    fonts: FONTS,
    colors: { appBg: '#0b1020', panel: '#11182b', panel2: '#1a2340', hover: '#24305a', line: '#2c3a66', editorBg: '#0e1426', codeBg: '#151d36', foreground: '#e8ecf8', muted: '#a8b1cf', faint: '#6f7ba3', accent: '#7aa2ff', warm: '#f2b766', folder: '#e0a84e', ok: '#7fd1a8', danger: '#ff7f8e' },
  },
  {
    id: 'forest',
    name: 'Forest',
    base: 'dark',
    builtin: true,
    fonts: { sans: 'humanist', mono: 'jetbrains' },
    colors: { appBg: '#0f1512', panel: '#151d18', panel2: '#1f2a23', hover: '#29372e', line: '#334538', editorBg: '#121a15', codeBg: '#18221c', foreground: '#eef3ea', muted: '#b4c2b3', faint: '#7a8c7b', accent: '#8fd19e', warm: '#e4b363', folder: '#d6a24c', ok: '#9ed58c', danger: '#f08a78' },
  },
  {
    id: 'ember',
    name: 'Ember',
    base: 'dark',
    builtin: true,
    fonts: FONTS,
    colors: { appBg: '#140f0d', panel: '#1c1513', panel2: '#2a1f1b', hover: '#372822', line: '#45332b', editorBg: '#17110f', codeBg: '#1f1714', foreground: '#f6eee8', muted: '#c9b6aa', faint: '#8f7a6e', accent: '#ff9a62', warm: '#ffc46b', folder: '#e9a94f', ok: '#a8cf8a', danger: '#ff7b72' },
  },
  {
    id: 'paper',
    name: 'Paper',
    base: 'light',
    builtin: true,
    fonts: { sans: 'serif', mono: 'jetbrains' },
    colors: { appBg: '#efe9dc', panel: '#f8f4ea', panel2: '#efe7d6', hover: '#e6dcc6', line: '#d6c9ad', editorBg: '#fbf8f1', codeBg: '#f1eadb', foreground: '#2e2619', muted: '#665a45', faint: '#9a8d74', accent: '#9a4f1c', warm: '#b9701f', folder: '#b98426', ok: '#4d7d39', danger: '#b33a2a' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    base: 'light',
    builtin: true,
    fonts: { sans: 'system', mono: 'system-mono' },
    colors: { appBg: '#e8f1f6', panel: '#f6fafc', panel2: '#e6f0f5', hover: '#d8e7ef', line: '#bfd5e1', editorBg: '#fbfdfe', codeBg: '#eaf2f7', foreground: '#11303f', muted: '#4a6676', faint: '#86a0ad', accent: '#0b7fab', warm: '#c3791d', folder: '#c08b24', ok: '#2f8a57', danger: '#c23b3b' },
  },
  {
    id: 'contrast',
    name: 'High contrast',
    base: 'dark',
    builtin: true,
    fonts: { sans: 'system', mono: 'jetbrains' },
    colors: { appBg: '#000000', panel: '#000000', panel2: '#141414', hover: '#262626', line: '#8a8a8a', editorBg: '#000000', codeBg: '#111111', foreground: '#ffffff', muted: '#e6e6e6', faint: '#bdbdbd', accent: '#ffd84d', warm: '#ffb347', folder: '#ffcc33', ok: '#6dff9b', danger: '#ff6b6b' },
  },
]

// ---- colors

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const toHex = (rgb: [number, number, number]) => '#' + rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')
const rgba = (hex: string, a: number) => {
  const c = parseHex(hex) ?? [128, 128, 128]
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`
}
/** Mix two colors: t = 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? [0, 0, 0]
  const y = parseHex(b) ?? [0, 0, 0]
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}
function luminance(hex: string): number {
  const c = parseHex(hex)
  if (!c) return 0
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** The WCAG contrast ratio between two colors (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** The CSS variables a theme sets on the app. */
export function themeVars(t: ThemeDef): Record<string, string> {
  const c = t.colors
  const dark = t.base === 'dark'
  const ink = contrast(c.accent, '#ffffff') >= contrast(c.accent, '#141414') ? '#ffffff' : mix(c.accent, '#000000', 0.82)
  const sans = FONT_STACKS.find((f) => f.id === t.fonts.sans)?.css ?? `'${t.fonts.sans}', ${FONT_STACKS[0].css}`
  const mono = MONO_STACKS.find((f) => f.id === t.fonts.mono)?.css ?? `'${t.fonts.mono}', ${MONO_STACKS[0].css}`
  return {
    '--app-bg': c.appBg,
    '--panel': c.panel,
    '--panel-2': c.panel2,
    '--hover': c.hover,
    '--line': c.line,
    '--line-soft': rgba(c.line, dark ? 0.55 : 0.7),
    '--accent': c.accent,
    '--accent-strong': mix(c.accent, dark ? '#000000' : '#000000', dark ? 0.1 : 0.18),
    '--accent-soft': dark ? rgba(c.accent, 0.16) : mix(c.accent, c.panel, 0.88),
    '--accent-ink': ink,
    '--foreground': c.foreground,
    '--muted-foreground': c.muted,
    '--faint': c.faint,
    '--editor-bg': c.editorBg,
    '--warm': c.warm,
    '--folder': c.folder,
    '--ok': c.ok,
    '--danger': c.danger,
    '--code-bg': c.codeBg,
    '--select': rgba(c.accent, dark ? 0.13 : 0.1),
    '--shadow': dark ? '0 12px 40px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3)' : `0 12px 40px ${rgba(c.foreground, 0.16)}, 0 2px 8px ${rgba(c.foreground, 0.08)}`,
    '--font-sans': sans,
    '--font-mono': mono,
  }
}

/** Contrast checks shown in the editor: [what, ratio, needed]. */
export function checks(c: ThemeColors): { label: string; ratio: number; need: number; fg: string; bg: string }[] {
  const ink = contrast(c.accent, '#ffffff') >= contrast(c.accent, '#141414') ? '#ffffff' : mix(c.accent, '#000000', 0.82)
  return [
    { label: 'Text on the page', fg: c.foreground, bg: c.editorBg, need: 4.5, ratio: contrast(c.foreground, c.editorBg) },
    { label: 'Text on panels', fg: c.foreground, bg: c.panel, need: 4.5, ratio: contrast(c.foreground, c.panel) },
    { label: 'Secondary text', fg: c.muted, bg: c.panel, need: 4.5, ratio: contrast(c.muted, c.panel) },
    { label: 'Faint text', fg: c.faint, bg: c.panel, need: 3, ratio: contrast(c.faint, c.panel) },
    { label: 'Accent on the page', fg: c.accent, bg: c.editorBg, need: 3, ratio: contrast(c.accent, c.editorBg) },
    { label: 'Text on accent buttons', fg: ink, bg: c.accent, need: 4.5, ratio: contrast(ink, c.accent) },
  ]
}

// ---- the user's themes, sharing

const KEYS: (keyof ThemeColors)[] = ['appBg', 'panel', 'panel2', 'hover', 'line', 'editorBg', 'codeBg', 'foreground', 'muted', 'faint', 'accent', 'warm', 'folder', 'ok', 'danger']

/** A theme from a file someone shared; null if it isn't one. Missing colors come from its base. */
export function parseTheme(json: unknown): Omit<ThemeDef, 'id'> | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const base: Mode = o.base === 'light' ? 'light' : 'dark'
  const from = base === 'light' ? LIGHT : DARK
  const raw = (o.colors && typeof o.colors === 'object' ? o.colors : {}) as Record<string, unknown>
  const colors = { ...from }
  let any = false
  for (const k of KEYS) {
    const v = raw[k]
    if (typeof v === 'string' && parseHex(v)) {
      colors[k] = toHex(parseHex(v)!)
      any = true
    }
  }
  if (!any) return null
  const f = (o.fonts && typeof o.fonts === 'object' ? o.fonts : {}) as Record<string, unknown>
  const font = (v: unknown, d: string) => (typeof v === 'string' && v.trim() && v.length < 80 && !/[;{}<>]/.test(v) ? v.trim() : d)
  return {
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Imported theme',
    base,
    colors,
    fonts: { sans: font(f.sans, 'manrope'), mono: font(f.mono, 'jetbrains') },
  }
}

/** What an exported theme file holds. */
export const exportTheme = (t: ThemeDef) => JSON.stringify({ format: 'brainwaves-theme', version: 1, name: t.name, base: t.base, colors: t.colors, fonts: t.fonts }, null, 2)

export const newThemeId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A theme by id among the built-in and the user's. */
export const findTheme = (id: string | undefined, custom: ThemeDef[]) => (id ? (custom.find((t) => t.id === id) ?? BUILTIN.find((t) => t.id === id)) : undefined)

/** The theme a mode uses now. */
export function activeTheme(mode: Mode, chosen: Partial<Record<Mode, string>>, custom: ThemeDef[]): ThemeDef {
  const t = findTheme(chosen[mode], custom)
  return t && t.base === mode ? t : BUILTIN.find((b) => b.id === mode)!
}
