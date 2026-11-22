/**
 * Inline formulas: a small expression language for live values in a page's text.
 *
 *   Status                       this page's property (or its cell, if it's a database row)
 *   prop("Due date")             …a name with spaces
 *   title                        this page's title (unless it has a property called title)
 *   [[Dune]].Rating              another page's property or cell
 *   [[Books]].count              rows of a database; also .count(Read = true)
 *   [[Books]].sum(Pages)  .avg(Rating)  .min(…)  .max(…)  .list(title)  .first(…)
 *   [[Books]].where(Read).count  a filtered set of rows
 *   if(Pages > 300, "long", "short")   and, or, not, = != < > <= >=, + - * / %
 *   round(x, 1)  abs  min  max  floor  ceil  len  upper  lower  contains(a, b)
 *   today()  now()  days(from, to)  date(x, "D MMM")  empty(x)  join(list, ", ")
 *
 * Inside a row method's argument, bare names are that row's fields (`count(Read = true)`).
 */

export type Value = number | string | boolean | null | Value[] | Rows

/** A set of database rows (what `[[Some database]]` and `.where(…)` give). */
export interface Rows {
  kind: 'rows'
  name: string
  rows: Record<string, Value>[]
}

export interface PageValues {
  title: string
  /** Property and cell values by lower-case name. */
  fields: Record<string, Value>
  /** Set when the page is a database: its rows. */
  rows?: Record<string, Value>[]
}

/** Where values come from (see `data.ts`). */
export interface Source {
  /** The page the formula is on. */
  here(): Promise<PageValues>
  /** A page by title (as in `[[Title]]`), or null. */
  page(title: string): Promise<PageValues | null>
}

// ---------------------------------------------------------------- parsing

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'page'; v: string } | { t: 'op'; v: string }

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (src.startsWith('[[', i)) {
      const end = src.indexOf(']]', i + 2)
      if (end < 0) throw new Error('A [[page]] is missing its ]]')
      out.push({ t: 'page', v: src.slice(i + 2, end).trim() })
      i = end + 2
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?\d+)?/i.exec(src.slice(i))!
      out.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }
    if (c === '"' || c === "'" || c === '“') {
      const close = c === '“' ? '”' : c
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== close) {
        if (src[j] === '\\' && j + 1 < src.length) j++
        s += src[j++]
      }
      if (j >= src.length) throw new Error('A text in quotes is missing its closing quote')
      out.push({ t: 'str', v: s })
      i = j + 1
      continue
    }
    if (/[\p{L}_]/u.test(c)) {
      const m = /^[\p{L}\p{N}_]+/u.exec(src.slice(i))!
      out.push({ t: 'id', v: m[0] })
      i += m[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two === '==' ? '=' : two === '&&' ? 'and' : two === '||' ? 'or' : two })
      i += 2
      continue
    }
    if ('+-*/%=<>(),.!&'.includes(c)) {
      out.push({ t: 'op', v: c === '!' ? 'not' : c })
      i++
      continue
    }
    throw new Error(`Unexpected "${c}"`)
  }
  return out
}

export type Node =
  | { k: 'lit'; v: Value }
  | { k: 'name'; name: string }
  | { k: 'page'; title: string }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'member'; of: Node; name: string; args: Node[] | null }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }

export function parse(src: string): Node {
  const toks = lex(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v
  const isWord = (v: string) => peek()?.t === 'id' && (peek()!.v as string).toLowerCase() === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"`)
    p++
  }
  const args = (): Node[] => {
    const out: Node[] = []
    expect('(')
    if (!isOp(')')) {
      out.push(expr())
      while (isOp(',')) {
        p++
        out.push(expr())
      }
    }
    expect(')')
    return out
  }
  const primary = (): Node => {
    const t = toks[p++]
    if (!t) throw new Error('The formula ends too soon')
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v }
    if (t.t === 'page') return { k: 'page', title: t.v }
    if (t.t === 'id') {
      const w = t.v.toLowerCase()
      if (w === 'true' || w === 'false') return { k: 'lit', v: w === 'true' }
      if (w === 'null' || w === 'empty' && !isOp('(')) return { k: 'lit', v: null }
      if (isOp('(')) return { k: 'call', fn: w, args: args() }
      return { k: 'name', name: t.v }
    }
    if (t.v === '(') {
      const e = expr()
      expect(')')
      return e
    }
    throw new Error(`Unexpected "${t.v}"`)
  }
  const postfix = (): Node => {
    let n = primary()
    while (isOp('.')) {
      p++
      const id = toks[p++]
      if (!id || id.t !== 'id') throw new Error('Expected a name after "."')
      n = { k: 'member', of: n, name: id.v, args: isOp('(') ? args() : null }
    }
    return n
  }
  const unary = (): Node => (isOp('-') ? (p++, { k: 'un', op: '-', a: unary() }) : postfix())
  const mul = (): Node => {
    let n = unary()
    while (isOp('*') || isOp('/') || isOp('%')) n = { k: 'bin', op: toks[p++].v as string, a: n, b: unary() }
    return n
  }
  const add = (): Node => {
    let n = mul()
    while (isOp('+') || isOp('-') || isOp('&')) {
      const op = toks[p++].v as string
      n = { k: 'bin', op: op === '&' ? '+' : op, a: n, b: mul() }
    }
    return n
  }
  const cmp = (): Node => {
    const n = add()
    for (const op of ['=', '!=', '<=', '>=', '<', '>']) if (isOp(op)) return (p++, { k: 'bin', op, a: n, b: add() })
    return n
  }
  const not = (): Node => (isWord('not') || isOp('not') ? (p++, { k: 'un', op: 'not', a: not() }) : cmp())
  const and = (): Node => {
    let n = not()
    while (isWord('and') || isOp('and')) n = (p++, { k: 'bin', op: 'and', a: n, b: not() })
    return n
  }
  const expr = (): Node => {
    let n = and()
    while (isWord('or') || isOp('or')) n = (p++, { k: 'bin', op: 'or', a: n, b: and() })
    return n
  }
  if (!toks.length) throw new Error('Empty formula')
  const n = expr()
  if (p < toks.length) throw new Error(`Unexpected "${(toks[p] as { v: unknown }).v}"`)
  return n
}

// ---------------------------------------------------------------- evaluating

const isRows = (v: Value): v is Rows => !!v && typeof v === 'object' && !Array.isArray(v) && (v as Rows).kind === 'rows'
const num = (v: Value): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (Array.isArray(v)) return v.length
  if (isRows(v)) return v.rows.length
  const n = Number(v)
  return v === null || v === '' || Number.isNaN(n) ? 0 : n
}
const truthy = (v: Value): boolean => (Array.isArray(v) ? v.length > 0 : isRows(v) ? v.rows.length > 0 : !!v && v !== '0')
export const isEmptyValue = (v: Value) => v === null || v === '' || (Array.isArray(v) && !v.length) || (isRows(v) && !v.rows.length)
const str = (v: Value): string => (Array.isArray(v) ? v.map(str).join(', ') : isRows(v) ? `${v.rows.length} rows` : v === null ? '' : String(v))
const isDate = (v: Value): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
const dayOf = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function equal(a: Value, b: Value): boolean {
  if (Array.isArray(a)) return Array.isArray(b) ? str(a) === str(b) : a.some((x) => equal(x, b))
  if (typeof a === 'number' || typeof b === 'number') return num(a) === num(b) && !(isEmptyValue(a) !== isEmptyValue(b) && (a === null || b === null))
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b)
  return str(a).toLowerCase() === str(b).toLowerCase()
}

function compare(a: Value, b: Value): number {
  if (isDate(a) && isDate(b)) return dayOf(a) - dayOf(b)
  if (typeof a === 'string' && typeof b === 'string' && (Number.isNaN(Number(a)) || Number.isNaN(Number(b)))) return a.localeCompare(b)
  return num(a) - num(b)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatDay(s: string, fmt: string) {
  const [y, m, d] = [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))]
  return fmt.replace(/YYYY|MMM|MM|DD|D/g, (t) => ({ YYYY: String(y), MMM: MONTHS[m - 1], MM: String(m).padStart(2, '0'), DD: String(d).padStart(2, '0'), D: String(d) })[t]!)
}

interface Scope {
  src: Source
  /** The current row, inside a row method's argument. */
  row?: Record<string, Value>
  depth: number
}

async function field(scope: Scope, name: string): Promise<Value> {
  const key = name.toLowerCase()
  if (scope.row && key in scope.row) return scope.row[key]
  const here = await scope.src.here()
  if (key in here.fields) return here.fields[key]
  if (key === 'title') return here.title
  if (scope.row) return null
  throw new Error(`This page has no property "${name}"`)
}

function member(target: Value | PageValues, name: string): Value {
  const key = name.toLowerCase()
  if (isRows(target as Value)) {
    const r = target as Rows
    if (key === 'count' || key === 'length') return r.rows.length
    throw new Error(`"${name}" needs brackets: .${name}(…)`)
  }
  const pv = target as PageValues
  if (pv && typeof pv === 'object' && 'fields' in pv) {
    if (key in pv.fields) return pv.fields[key]
    if (key === 'title') return pv.title
    if (pv.rows && (key === 'count' || key === 'length')) return pv.rows.length
    throw new Error(`No property "${name}"`)
  }
  if (Array.isArray(target)) return key === 'count' || key === 'length' ? target.length : null
  if (typeof target === 'string' && key === 'length') return target.length
  throw new Error(`Can't read "${name}" of ${JSON.stringify(target)}`)
}

const asRows = (v: Value | PageValues, name: string): Rows => {
  if (isRows(v as Value)) return v as Rows
  const pv = v as PageValues
  if (pv && typeof pv === 'object' && 'rows' in pv && pv.rows) return { kind: 'rows', name: pv.title, rows: pv.rows }
  throw new Error(`.${name}(…) works on a database`)
}

async function ev(n: Node, s: Scope): Promise<Value | PageValues> {
  if (s.depth > 200) throw new Error('The formula is too deep')
  const sub = (x: Node, row = s.row) => ev(x, { ...s, row, depth: s.depth + 1 }) as Promise<Value>
  switch (n.k) {
    case 'lit':
      return n.v
    case 'name':
      if (n.name.toLowerCase() === 'this' && !s.row) return s.src.here()
      return field(s, n.name)
    case 'page': {
      const pv = await s.src.page(n.title)
      if (!pv) throw new Error(`No page called "${n.title}"`)
      return pv
    }
    case 'un': {
      const a = await sub(n.a)
      return n.op === '-' ? -num(a) : !truthy(a)
    }
    case 'bin': {
      if (n.op === 'and') return truthy(await sub(n.a)) && truthy(await sub(n.b))
      if (n.op === 'or') return truthy(await sub(n.a)) || truthy(await sub(n.b))
      const [a, b] = [await sub(n.a), await sub(n.b)]
      switch (n.op) {
        case '+':
          if (typeof a === 'string' || typeof b === 'string' || Array.isArray(a) || Array.isArray(b)) {
            if (isDate(a) && typeof b === 'number') return iso(new Date(dayOf(a) + b * 86400000))
            return str(a) + str(b)
          }
          return num(a) + num(b)
        case '-':
          if (isDate(a) && isDate(b)) return Math.round((dayOf(a) - dayOf(b)) / 86400000)
          if (isDate(a) && typeof b === 'number') return iso(new Date(dayOf(a) - b * 86400000))
          return num(a) - num(b)
        case '*':
          return num(a) * num(b)
        case '/':
          return num(b) === 0 ? null : num(a) / num(b)
        case '%':
          return num(b) === 0 ? null : num(a) % num(b)
        case '=':
          return equal(a, b)
        case '!=':
          return !equal(a, b)
        case '<':
          return compare(a, b) < 0
        case '>':
          return compare(a, b) > 0
        case '<=':
          return compare(a, b) <= 0
        case '>=':
          return compare(a, b) >= 0
      }
      throw new Error(`Unknown operator ${n.op}`)
    }
    case 'member': {
      const target = await ev(n.of, { ...s, depth: s.depth + 1 })
      if (!n.args) return member(target, n.name)
      const m = n.name.toLowerCase()
      if (m === 'prop' || m === 'get') {
        const name = str(await sub(n.args[0]))
        return member(target, name)
      }
      const rows = asRows(target, n.name)
      const each = async (x: Node | undefined) => Promise.all(rows.rows.map((r) => (x ? sub(x, r) : Promise.resolve(r.title ?? null))))
      switch (m) {
        case 'where':
        case 'filter': {
          const keep = await each(n.args[0])
          return { kind: 'rows', name: rows.name, rows: rows.rows.filter((_, i) => truthy(keep[i] as Value)) }
        }
        case 'count': {
          if (!n.args.length) return rows.rows.length
          return (await each(n.args[0])).filter((v) => truthy(v as Value)).length
        }
        case 'sum':
          return (await each(n.args[0])).reduce((t: number, v) => t + num(v as Value), 0)
        case 'avg':
        case 'average': {
          const vs = (await each(n.args[0])).filter((v) => !isEmptyValue(v as Value))
          return vs.length ? vs.reduce((t: number, v) => t + num(v as Value), 0) / vs.length : null
        }
        case 'min':
        case 'max': {
          const vs = (await each(n.args[0])).filter((v) => !isEmptyValue(v as Value)) as Value[]
          if (!vs.length) return null
          return vs.reduce((a, b) => ((m === 'min' ? compare(b, a) < 0 : compare(b, a) > 0) ? b : a))
        }
        case 'list':
        case 'map':
          return (await each(n.args[0])) as Value[]
        case 'first':
          return rows.rows.length ? ((n.args[0] ? await sub(n.args[0], rows.rows[0]) : rows.rows[0].title) ?? null) : null
        case 'sort':
        case 'sortdesc': {
          const keys = await each(n.args[0])
          const order = rows.rows.map((r, i) => [r, keys[i]] as const).sort((x, y) => compare(x[1] as Value, y[1] as Value) * (m === 'sortdesc' ? -1 : 1))
          return { kind: 'rows', name: rows.name, rows: order.map((x) => x[0]) }
        }
      }
      throw new Error(`Unknown row method .${n.name}(…)`)
    }
    case 'call': {
      const a = async (i: number) => sub(n.args[i])
      const all = async () => Promise.all(n.args.map((x) => sub(x)))
      switch (n.fn) {
        case 'if':
          return truthy(await a(0)) ? (n.args[1] ? a(1) : true) : n.args[2] ? a(2) : null
        case 'prop':
          return field(s, str(await a(0)))
        case 'round': {
          const d = n.args[1] ? num(await a(1)) : 0
          const f = 10 ** d
          return Math.round(num(await a(0)) * f) / f
        }
        case 'floor':
          return Math.floor(num(await a(0)))
        case 'ceil':
          return Math.ceil(num(await a(0)))
        case 'abs':
          return Math.abs(num(await a(0)))
        case 'min':
        case 'max': {
          const vs = (await all()).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => !isEmptyValue(v))
          return vs.length ? vs.reduce((x, y) => ((n.fn === 'min' ? compare(y, x) < 0 : compare(y, x) > 0) ? y : x)) : null
        }
        case 'len':
        case 'length': {
          const v = await a(0)
          return Array.isArray(v) ? v.length : isRows(v) ? v.rows.length : str(v).length
        }
        case 'upper':
          return str(await a(0)).toUpperCase()
        case 'lower':
          return str(await a(0)).toLowerCase()
        case 'contains': {
          const [x, y] = [await a(0), await a(1)]
          return Array.isArray(x) ? x.some((v) => equal(v, y)) : str(x).toLowerCase().includes(str(y).toLowerCase())
        }
        case 'empty':
          return isEmptyValue(await a(0))
        case 'join': {
          const v = await a(0)
          return (Array.isArray(v) ? v : [v]).map(str).join(n.args[1] ? str(await a(1)) : ', ')
        }
        case 'today':
          return iso(new Date())
        case 'now': {
          const d = new Date()
          return `${iso(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        }
        case 'days': {
          const [x, y] = [await a(0), n.args[1] ? await a(1) : iso(new Date())]
          if (!isDate(x) || !isDate(y)) return null
          return Math.round((dayOf(y) - dayOf(x)) / 86400000)
        }
        case 'date': {
          const v = await a(0)
          if (!isDate(v)) return v
          return n.args[1] ? formatDay(v, str(await a(1))) : v.slice(0, 10)
        }
        case 'number':
          return num(await a(0))
        case 'text':
          return str(await a(0))
      }
      throw new Error(`Unknown function ${n.fn}()`)
    }
  }
}

/** Run a formula. Errors come back as `{ error }`. */
export async function evaluate(src: string, source: Source): Promise<{ value: Value } | { error: string }> {
  try {
    const v = await ev(parse(src), { src: source, depth: 0 })
    if (v && typeof v === 'object' && !Array.isArray(v) && 'fields' in v) return { value: (v as PageValues).title }
    return { value: v as Value }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** A value as shown in the text. */
export function show(v: Value): string {
  if (v === null || v === '') return '—'
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—'
  if (isRows(v)) return `${v.rows.length} rows`
  return v
}
