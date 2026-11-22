/**
 * Template variables: `{{…}}` in any text of a template (titles, blocks, properties, header).
 *
 *   {{title}}               the new page's title
 *   {{date}}  {{time}}      today (YYYY-MM-DD), now (HH:mm)
 *   {{date:DD MMM YYYY}}    a date in a format (YYYY YY MMMM MMM MM M DD D dddd ddd HH mm)
 *   {{date+7}} {{date-1:dddd}}   days from today
 *   {{weekday}} {{week}}    Monday…, ISO week number
 *   {{parent}}              the title of the page it's created under
 *   {{Client}}              anything else is asked in the form
 *   {{Due: date}}           …as a date (also: number)
 *   {{Status: Todo | Doing | Done}}   …as a choice
 *   {{Author = Ray}}        …with a default (works with the forms above too)
 *
 * A name used several times is asked once; its first mention with a type or default wins.
 * `\{{` keeps the braces as typed.
 */

export type VarKind = 'text' | 'date' | 'number' | 'choice'

export interface Variable {
  name: string
  kind: VarKind
  options: string[]
  default: string
}

export interface Context {
  /** The asked variables' values, by name (case-insensitive). */
  values: Record<string, string>
  title: string
  parent: string
  template: string
  now: Date
}

const VAR = /(\\?)\{\{\s*([^{}]+?)\s*\}\}/g
const BUILTIN = /^(title|date|time|now|today|tomorrow|yesterday|weekday|week|parent|template)\b/i
const DATE_EXPR = /^(date|today|now|tomorrow|yesterday)\s*([+-]\s*\d+)?\s*(?::\s*(.+))?$/i

/** The parts of `{{…}}`: a name, and maybe a type, choices or a default. */
export function parseVar(raw: string): Variable {
  let body = raw.trim()
  let def = ''
  const eq = body.indexOf('=')
  if (eq > 0) {
    def = body.slice(eq + 1).trim()
    body = body.slice(0, eq).trim()
  }
  const colon = body.indexOf(':')
  const name = (colon > 0 ? body.slice(0, colon) : body).trim()
  const spec = colon > 0 ? body.slice(colon + 1).trim() : ''
  if (spec.includes('|')) return { name, kind: 'choice', options: spec.split('|').map((s) => s.trim()).filter(Boolean), default: def }
  if (/^date$/i.test(spec)) return { name, kind: 'date', options: [], default: def }
  if (/^number$/i.test(spec)) return { name, kind: 'number', options: [], default: def }
  return { name, kind: 'text', options: [], default: def }
}

export const isBuiltin = (raw: string) => BUILTIN.test(raw.trim()) && !raw.includes('=') && !/^\s*\w+\s*:\s*.*\|/.test(raw)

/** Every variable the form has to ask for in these texts, in order of first mention. */
export function collectVars(texts: Iterable<string>): Variable[] {
  const out = new Map<string, Variable>()
  for (const t of texts) {
    for (const m of t.matchAll(VAR)) {
      if (m[1] || isBuiltin(m[2])) continue
      if (/^template\s*:/i.test(m[2].trim())) continue
      const v = parseVar(m[2])
      if (!v.name) continue
      const key = v.name.toLowerCase()
      const seen = out.get(key)
      // A later mention can add the type or default an earlier bare `{{Name}}` lacked.
      if (!seen) out.set(key, v)
      else if (seen.kind === 'text' && v.kind !== 'text') out.set(key, { ...v, default: v.default || seen.default })
      else if (!seen.default && v.default) out.set(key, { ...seen, default: v.default })
    }
  }
  return [...out.values()]
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - start.getTime()) / 86400000 + 1) / 7)
}

/** `YYYY-MM-DD`-style formatting. Text in [brackets] is kept as is. */
export function formatDate(d: Date, fmt: string): string {
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    YY: () => String(d.getFullYear()).slice(-2),
    MMMM: () => MONTHS[d.getMonth()],
    MMM: () => MONTHS[d.getMonth()].slice(0, 3),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    dddd: () => DAYS[d.getDay()],
    ddd: () => DAYS[d.getDay()].slice(0, 3),
    DD: () => pad(d.getDate()),
    D: () => String(d.getDate()),
    HH: () => pad(d.getHours()),
    mm: () => pad(d.getMinutes()),
    WW: () => pad(isoWeek(d)),
  }
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|mm|WW/g, (m, lit) => (lit !== undefined ? lit : tokens[m]()))
}

function builtin(raw: string, ctx: Context): string | null {
  const s = raw.trim()
  const dm = s.match(DATE_EXPR)
  if (dm) {
    const word = dm[1].toLowerCase()
    const d = new Date(ctx.now)
    const shift = (dm[2] ? Number(dm[2].replace(/\s+/g, '')) : 0) + (word === 'tomorrow' ? 1 : word === 'yesterday' ? -1 : 0)
    d.setDate(d.getDate() + shift)
    return formatDate(d, dm[3] ?? (word === 'now' ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD'))
  }
  switch (s.toLowerCase()) {
    case 'title':
      return ctx.title
    case 'time':
      return formatDate(ctx.now, 'HH:mm')
    case 'weekday':
      return DAYS[ctx.now.getDay()]
    case 'week':
      return String(isoWeek(ctx.now))
    case 'parent':
      return ctx.parent
    case 'template':
      return ctx.template
  }
  return null
}

/** Fill in every `{{…}}` of a text. */
export function render(text: string, ctx: Context): string {
  if (!text.includes('{{')) return text
  return text.replace(VAR, (all, esc: string, raw: string) => {
    if (esc) return all.slice(1)
    if (/^template\s*:/i.test(raw.trim())) return all
    const b = isBuiltin(raw) ? builtin(raw, ctx) : null
    if (b !== null) return b
    const v = parseVar(raw)
    const val = ctx.values[v.name.toLowerCase()]
    return val !== undefined && val !== '' ? val : v.default
  })
}

/**
 * The text syntax for using a template in a page:
 *   {{template: Meeting notes | title: Weekly sync | Client: Acme}}
 * Returns the template's name and the given values (keys lower-cased), or null.
 */
export function parseTemplateCall(text: string): { name: string; values: Record<string, string> } | null {
  const m = text.trim().match(/^\{\{\s*template\s*:\s*([^{}]+?)\s*\}\}$/i)
  if (!m) return null
  const [name, ...rest] = m[1].split('|').map((s) => s.trim())
  if (!name) return null
  const values: Record<string, string> = {}
  for (const part of rest) {
    const i = part.search(/[:=]/)
    if (i > 0) values[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
  }
  return { name, values }
}
