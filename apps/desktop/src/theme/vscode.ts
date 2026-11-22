import { contrast, mix, parseHex, type Mode, type ThemeColors, type ThemeDef } from './themes'

/**
 * VS Code colour themes → BrainWaves themes.
 *
 * Reads a theme file (`.json`, with the comments and trailing commas VS Code allows) or a whole
 * extension (`.vsix`, as downloaded from the Marketplace; every colour theme in it). VS Code's
 * workbench colours are mapped onto BrainWaves' fifteen theme colours, with sensible fallbacks
 * for whatever a theme leaves out. The result is an ordinary BrainWaves theme: pick it, tune it
 * in the theme editor, export it.
 */

type Json = Record<string, unknown>
type VsTheme = { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: unknown; include?: string }

/** JSON with comments and trailing commas (VS Code's "JSONC"). */
export function parseJsonc(text: string): unknown {
  let out = ''
  let i = 0
  let inStr = false
  while (i < text.length) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inStr = false
      i++
    } else if (c === '"') {
      inStr = true
      out += c
      i++
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
    } else {
      out += c
      i++
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

/** Does this look like a VS Code colour theme? */
export function isVsCodeTheme(o: unknown): o is VsTheme {
  if (!o || typeof o !== 'object') return false
  const t = o as Json
  const colors = t.colors as Json | undefined
  return !!(Array.isArray(t.tokenColors) || (colors && typeof colors === 'object' && Object.keys(colors).some((k) => k.includes('.'))) || /^(dark|light|hc|hc-light|hc-black|vs|vs-dark)$/.test(String(t.type ?? '')))
}

const hex = (c: string) => {
  const rgb = parseHex(c)
  return rgb ? '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('') : null
}

/** A VS Code colour (#rgb, #rgba, #rrggbb, #rrggbbaa) as #rrggbb, blending any transparency over `under`. */
function solid(v: unknown, under: string): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
  if (!m) return hex(s)
  let h = m[1]
  if (h.length <= 4) h = h.split('').map((x) => x + x).join('')
  const rgb = '#' + h.slice(0, 6)
  if (h.length === 6) return rgb.toLowerCase()
  const a = parseInt(h.slice(6, 8), 16) / 255
  if (a <= 0.02) return null
  return mix(under, rgb, a)
}

const luminance = (c: string) => {
  const [r, g, b] = parseHex(c) ?? [0, 0, 0]
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** The first of `keys` that a theme sets, as a solid colour. */
function pick(colors: Record<string, string>, under: string, ...keys: string[]): string | null {
  for (const k of keys) {
    const c = solid(colors[k], under)
    if (c) return c
  }
  return null
}

/** A token colour (from `tokenColors`) for a scope, e.g. "string" or "keyword". */
function tokenColor(tokens: unknown, scope: string, under: string): string | null {
  if (!Array.isArray(tokens)) return null
  for (const t of tokens as { scope?: string | string[]; settings?: { foreground?: string } }[]) {
    const scopes = Array.isArray(t.scope) ? t.scope : String(t.scope ?? '').split(',')
    if (scopes.some((s) => s.trim() === scope || s.trim().startsWith(scope + '.')) && t.settings?.foreground) {
      const c = solid(t.settings.foreground, under)
      if (c) return c
    }
  }
  return null
}

/** The first candidate that reads well enough on `bg` (else the best of them). */
function readable(bg: string, need: number, ...cands: (string | null)[]): string | null {
  const ok = cands.filter((c): c is string => !!c)
  return ok.find((c) => contrast(c, bg) >= need) ?? ok.sort((a, b) => contrast(b, bg) - contrast(a, bg))[0] ?? null
}

/** A VS Code theme (already parsed, `include`s merged) as a BrainWaves theme. */
export function fromVsCode(t: VsTheme, fallbackName = 'VS Code theme'): Omit<ThemeDef, 'id'> {
  const c = (t.colors ?? {}) as Record<string, string>
  const tokens = t.tokenColors
  const defaultFg = Array.isArray(tokens) ? (tokens as { scope?: unknown; settings?: { foreground?: string; background?: string } }[]).find((x) => !x.scope)?.settings : undefined

  const editorBg = solid(c['editor.background'], '#1e1e1e') ?? solid(defaultFg?.background, '#1e1e1e') ?? (/light/.test(String(t.type)) ? '#ffffff' : '#1e1e1e')
  const type = String(t.type ?? '')
  const base: Mode = type === 'light' || type === 'hc-light' || type === 'vs' ? 'light' : type ? 'dark' : luminance(editorBg) > 0.55 ? 'light' : 'dark'
  const dark = base === 'dark'
  const fg = readable(editorBg, 7, pick(c, editorBg, 'editor.foreground', 'foreground'), solid(defaultFg?.foreground, editorBg)) ?? (dark ? '#e6e6e6' : '#1f1f1f')
  const shade = (by: number) => mix(editorBg, dark ? '#000000' : '#000000', by)

  const appBg = pick(c, editorBg, 'activityBar.background', 'titleBar.activeBackground', 'sideBar.background') ?? shade(dark ? 0.25 : 0.04)
  const panel = pick(c, editorBg, 'sideBar.background', 'editorGroupHeader.tabsBackground', 'panel.background') ?? editorBg
  const panel2 = pick(c, panel, 'input.background', 'dropdown.background', 'editorWidget.background', 'quickInput.background') ?? mix(panel, fg, 0.06)
  const hover = pick(c, panel, 'list.hoverBackground', 'list.inactiveSelectionBackground', 'toolbar.hoverBackground') ?? mix(panel, fg, 0.1)
  const line = pick(c, panel, 'panel.border', 'sideBar.border', 'editorGroup.border', 'tab.border', 'contrastBorder') ?? mix(panel, fg, 0.16)
  const codeBg = pick(c, editorBg, 'textCodeBlock.background', 'editorWidget.background', 'editor.lineHighlightBackground') ?? mix(editorBg, fg, 0.05)
  const muted = readable(editorBg, 4.5, pick(c, editorBg, 'descriptionForeground', 'sideBar.foreground', 'tab.inactiveForeground')) ?? mix(fg, editorBg, 0.3)
  const faint = pick(c, editorBg, 'editorLineNumber.foreground', 'disabledForeground', 'editorCodeLens.foreground') ?? mix(fg, editorBg, 0.55)
  const accent =
    readable(
      editorBg,
      3,
      pick(c, editorBg, 'textLink.foreground'),
      pick(c, editorBg, 'button.background'),
      pick(c, editorBg, 'activityBarBadge.background'),
      pick(c, editorBg, 'focusBorder'),
      pick(c, editorBg, 'progressBar.background'),
      tokenColor(tokens, 'keyword', editorBg),
    ) ?? (dark ? '#d7b9ff' : '#6842bd')
  const warm = pick(c, editorBg, 'editorWarning.foreground', 'terminal.ansiYellow') ?? tokenColor(tokens, 'string', editorBg) ?? (dark ? '#e6a55d' : '#c27a2c')
  const folder = pick(c, editorBg, 'terminal.ansiYellow', 'editorWarning.foreground') ?? warm
  const ok = pick(c, editorBg, 'terminal.ansiGreen', 'gitDecoration.addedResourceForeground', 'testing.iconPassed') ?? (dark ? '#91c89b' : '#3f8a4c')
  const danger = pick(c, editorBg, 'errorForeground', 'editorError.foreground', 'terminal.ansiRed') ?? (dark ? '#ff8a80' : '#c63b30')

  const colors: ThemeColors = { appBg, panel, panel2, hover, line, editorBg, codeBg, foreground: fg, muted, faint, accent, warm, folder, ok, danger }
  return {
    name: (typeof t.name === 'string' && t.name.trim() ? t.name.trim() : fallbackName).slice(0, 40),
    base,
    colors,
    fonts: { sans: 'manrope', mono: 'jetbrains' },
  }
}

// ---------------------------------------------------------------- .vsix (a zip file)

/** The files in a zip, by path (a tiny reader: stored and deflated entries). */
async function unzip(buf: ArrayBuffer): Promise<Map<string, () => Promise<Uint8Array>>> {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("That isn't a .vsix (zip) file")
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const files = new Map<string, () => Promise<Uint8Array>>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    p += 46 + nameLen + extraLen + commentLen
    files.set(name, async () => {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
      const data = new Uint8Array(buf, start, size)
      if (method === 0) return data
      if (method !== 8) throw new Error(`Unsupported compression in ${name}`)
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    })
  }
  return files
}

const norm = (path: string) => {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

/** Every colour theme in a VS Code extension (.vsix). */
export async function themesFromVsix(buf: ArrayBuffer): Promise<Omit<ThemeDef, 'id'>[]> {
  const files = await unzip(buf)
  const text = async (path: string) => {
    const f = files.get(path)
    if (!f) throw new Error(`Missing ${path} in the extension`)
    return new TextDecoder().decode(await f())
  }
  const pkg = parseJsonc(await text('extension/package.json')) as { displayName?: string; contributes?: { themes?: { label?: string; uiTheme?: string; path: string }[] } }
  const list = pkg.contributes?.themes ?? []
  if (!list.length) throw new Error('This extension has no colour themes')
  // Labels like "%darkThemeLabel%" are looked up in package.nls.json.
  const nls = (await text('extension/package.nls.json').then((t) => parseJsonc(t) as Record<string, unknown>).catch(() => ({}))) as Record<string, unknown>
  const label = (s: string | undefined) => {
    const m = s && /^%(.+)%$/.exec(s)
    if (!m) return s
    const v = nls[m[1]]
    return typeof v === 'string' ? v : typeof v === 'object' && v && typeof (v as { message?: unknown }).message === 'string' ? (v as { message: string }).message : undefined
  }
  // A theme can "include" another file (its base); merge it underneath.
  const load = async (path: string, depth = 0): Promise<VsTheme> => {
    const t = parseJsonc(await text(path)) as VsTheme
    if (t.include && depth < 4) {
      const under = await load(norm(path.split('/').slice(0, -1).join('/') + '/' + t.include), depth + 1).catch(() => ({}) as VsTheme)
      return {
        ...under,
        ...t,
        colors: { ...(under.colors ?? {}), ...(t.colors ?? {}) },
        tokenColors: [...(Array.isArray(under.tokenColors) ? under.tokenColors : []), ...(Array.isArray(t.tokenColors) ? t.tokenColors : [])],
      }
    }
    return t
  }
  const out: Omit<ThemeDef, 'id'>[] = []
  for (const entry of list) {
    try {
      const t = await load(norm('extension/' + entry.path))
      const type = t.type ?? (entry.uiTheme === 'vs' ? 'light' : entry.uiTheme === 'hc-light' ? 'hc-light' : 'dark')
      out.push(fromVsCode({ ...t, type, name: label(entry.label) || t.name }, label(pkg.displayName)))
    } catch {
      /* skip a theme that doesn't parse */
    }
  }
  if (!out.length) throw new Error("Couldn't read the themes in this extension")
  return out
}
