/**
 * What runs inside a widget's sandbox (an iframe with `sandbox="allow-scripts"`: no same-origin
 * access, no app storage, no Tauri IPC) and the document wrapper around the widget's own HTML.
 *
 * The widget sees one global, `bw`:
 *
 *   await bw.ready                          slots, settings and theme have arrived
 *   bw.slots / bw.settings / bw.editable
 *   await bw.query(slot, { filters, sorts, limit })
 *   const stop = bw.subscribe(slot, query, (result) => …)   live: re-sent whenever the data changes
 *   await bw.mutate(slot, rowId, { field: value, title: '…' })
 *   const id = await bw.createRow(slot, { title: '…', field: value })
 *   bw.openRow(rowId)                        open a row of a bound database as a page
 *   await bw.setSettings({ … })              the widget's own options (stored on its block)
 *   bw.onSettings((settings) => …)
 *
 * Everything goes to the host by postMessage; the host adds which widget block is calling and
 * the Rust core checks every call against that block's bindings.
 */
const CLIENT = `(() => {
  let seq = 0, readyResolve
  const pending = new Map(), subs = new Map(), settingsCbs = new Set()
  const post = (m) => parent.postMessage(Object.assign({ bw: 1 }, m), '*')
  const call = (op, args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); post({ id, op, args }) })
  const bw = {
    ready: new Promise((r) => (readyResolve = r)),
    slots: {}, settings: {}, editable: false, theme: {},
    query: (slot, query) => call('query', { slot, query: query || {} }),
    subscribe(slot, query, cb) {
      const sub = ++seq
      subs.set(sub, cb)
      post({ op: 'subscribe', sub, args: { slot, query: query || {} } })
      return () => { subs.delete(sub); post({ op: 'unsubscribe', sub }) }
    },
    mutate: (slot, rowId, values) => call('mutate', { slot, rowId, values }),
    createRow: (slot, values) => call('createRow', { slot, values: values || {} }),
    openRow: (rowId) => post({ op: 'openRow', args: { rowId } }),
    setSettings: (settings) => call('setSettings', { settings }),
    onSettings: (cb) => (settingsCbs.add(cb), () => settingsCbs.delete(cb)),
  }
  addEventListener('message', (e) => {
    if (e.source !== parent) return
    const m = e.data
    if (!m || m.bw !== 1) return
    if (m.event === 'init') {
      bw.slots = m.slots; bw.settings = m.settings; bw.editable = m.editable; bw.theme = m.theme
      for (const [k, v] of Object.entries(m.theme || {})) document.documentElement.style.setProperty(k, v)
      readyResolve(bw)
      return
    }
    if (m.event === 'data') { const cb = subs.get(m.sub); if (cb) cb(m.result, m.error); return }
    if (m.event === 'theme') {
      bw.theme = m.theme
      for (const [k, v] of Object.entries(m.theme || {})) document.documentElement.style.setProperty(k, v)
      return
    }
    if (m.event === 'settings') { bw.settings = m.settings; settingsCbs.forEach((cb) => cb(m.settings)); return }
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    m.ok ? p.res(m.result) : p.rej(new Error(m.error))
  })
  window.bw = bw
  const size = () => post({ op: 'resize', args: { height: Math.ceil(document.documentElement.getBoundingClientRect().height) } })
  new ResizeObserver(size).observe(document.documentElement)
  post({ op: 'hello' })
})()`

/** Networking, frames, forms and plugins are off: a widget can only talk to its host. */
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

const BASE_CSS = `
  html, body { margin: 0; background: transparent; }
  body { font: 13px/1.5 var(--bw-font, system-ui, sans-serif); color: var(--bw-fg, #ddd); padding: 2px 0 4px; overflow: hidden; }
  * { box-sizing: border-box; }
  button, input, select { font: inherit; color: inherit; }
`

/** Wrap a widget's HTML: CSP first (so it applies to everything after), then base styles and `bw`. */
export function buildSrcdoc(html: string): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${BASE_CSS}</style><script>${CLIENT}</script>`
  const m = html.match(/<head[^>]*>/i)
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length
    return html.slice(0, at) + head + html.slice(at)
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`
}

/** The app's colors and font, passed to widgets as CSS variables. */
export function themeVars(): Record<string, string> {
  const root = document.querySelector('.workspace') ?? document.documentElement
  const s = getComputedStyle(root)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return {
    '--bw-fg': v('--foreground'),
    '--bw-muted': v('--muted-foreground'),
    '--bw-faint': v('--faint'),
    '--bw-accent': v('--accent'),
    '--bw-accent-soft': v('--accent-soft'),
    '--bw-accent-ink': v('--accent-ink'),
    '--bw-panel': v('--panel'),
    '--bw-panel-2': v('--panel-2'),
    '--bw-line': v('--line'),
    '--bw-ok': v('--ok'),
    '--bw-danger': v('--danger'),
    // App fonts aren't loadable in the sandbox (no network); the fallbacks in the stack are.
    '--bw-font': s.fontFamily,
  }
}

/** A widget file carries its manifest in `<script type="application/bw-widget+json">`. */
export function manifestFromHtml(html: string): unknown {
  const m = html.match(/<script[^>]*type=["']application\/bw-widget\+json["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m) throw new Error('No manifest found: add <script type="application/bw-widget+json">{ … }</script> to the widget file.')
  return JSON.parse(m[1])
}
