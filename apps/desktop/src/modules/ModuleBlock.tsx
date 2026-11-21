import type { WidgetBlockProps } from '@brainwaves/editor'
import { Puzzle, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushAll } from '../lib/core/page-sync'
import { coreClient } from '../lib/storage'
import { openPage } from '../state/actions'
import { getState, useApp } from '../state/store'
import { buildSrcdoc, themeVars } from '../widgets/runtime'
import { approveModule, chooseFolderFor, describeCapability, moduleCall, moduleInfo, refreshModules, type ModuleInfo } from './api'

/**
 * What runs inside a module's sandbox: the `bw` client. Everything is a message to the host,
 * which adds the module's id (from the module it started, never from the message) and the
 * core checks it against the capabilities the user approved. See docs/modules.md.
 */
const CLIENT = `(() => {
  let seq = 0, readyResolve
  const pending = new Map(), subs = new Map(), fsCbs = new Set(), settingsCbs = new Set()
  const post = (m) => parent.postMessage(Object.assign({ bw: 1 }, m), '*')
  const call = (op, args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); post({ id, op, args: args || {} }) })
  const bw = {
    ready: new Promise((r) => (readyResolve = r)),
    module: {}, pageId: '', settings: {}, editable: false, theme: {},
    fs: {
      roots: () => call('fs.roots'),
      pickFolder: (title) => call('fs.pickFolder', { title }),
      list: (path, o) => call('fs.list', Object.assign({ path }, o || {})),
      readText: (path, o) => call('fs.readText', Object.assign({ path }, o || {})),
      open: (path) => call('fs.open', { path }),
      onChange: (cb) => (fsCbs.add(cb), () => fsCbs.delete(cb)),
    },
    db: {
      create: (o) => call('db.create', o || {}),
      setProperty: (databaseId, property) => call('db.setProperty', { databaseId, property }),
      query: (databaseId, view) => call('db.query', { databaseId, view }),
      subscribe(databaseId, view, cb) {
        const sub = ++seq
        subs.set(sub, cb)
        post({ op: 'db.subscribe', sub, args: { databaseId, view } })
        return () => { subs.delete(sub); post({ op: 'db.unsubscribe', sub }) }
      },
      createRow: (databaseId, title, values) => call('db.createRow', { databaseId, title, values: values || {} }),
      setValue: (rowId, propertyId, value) => call('db.setValue', { rowId, propertyId, value }),
    },
    props: {
      get: (pageId) => call('props.get', { pageId }),
      set: (props, pageId) => call('props.set', { props, pageId }),
    },
    openPage: (id) => post({ op: 'openPage', args: { id } }),
    setSettings: (settings) => call('setSettings', { settings }),
    onSettings: (cb) => (settingsCbs.add(cb), () => settingsCbs.delete(cb)),
  }
  const theme = (t) => { for (const [k, v] of Object.entries(t || {})) document.documentElement.style.setProperty(k, v) }
  addEventListener('message', (e) => {
    if (e.source !== parent) return
    const m = e.data
    if (!m || m.bw !== 1) return
    if (m.event === 'init') {
      Object.assign(bw, { module: m.module, pageId: m.pageId, settings: m.settings, editable: m.editable, theme: m.theme })
      theme(m.theme); readyResolve(bw); return
    }
    if (m.event === 'theme') { bw.theme = m.theme; theme(m.theme); return }
    if (m.event === 'data') { const cb = subs.get(m.sub); if (cb) cb(m.result, m.error); return }
    if (m.event === 'fs') { fsCbs.forEach((cb) => cb(m.root)); return }
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

/** A module instance in a page (a `widget` block whose widget is `module:<id>`). */
export function ModuleBlock(props: WidgetBlockProps & { pageId: string; moduleId: string }) {
  const [info, setInfo] = useState<ModuleInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    moduleInfo(props.moduleId).then(
      (m) => (setInfo(m), setError(null)),
      (e) => setError(String(e)),
    )
  useEffect(() => void load(), [props.moduleId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="widget-missing">Module “{props.moduleId}” is not installed.</div>
  if (!info) return <div className="widget-loading" />
  if (!info.approved) {
    return (
      <div className="widget-setup">
        <div className="widget-setup-head">
          {info.manifest.icon ? <span className="widget-setup-icon">{info.manifest.icon}</span> : <Puzzle size={16} />}
          <div>
            <div className="widget-setup-title">{info.manifest.name} needs your approval</div>
            <div className="widget-setup-desc">It asks to:</div>
          </div>
        </div>
        <ul className="module-caps">
          {info.manifest.capabilities.map((c) => (
            <li key={c}>{describeCapability(c)}</li>
          ))}
        </ul>
        {props.editable && (
          <div className="db-form-actions">
            <button className="primary-btn" onClick={() => void approveModule(info.manifest.id).then(load).then(refreshModules)}>
              <ShieldCheck size={14} /> Approve
            </button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="widget-frame">
      <div className="widget-bar">
        <span className="widget-name">
          {info.manifest.icon ? <span>{info.manifest.icon}</span> : <Puzzle size={13} />}
          {info.manifest.name}
        </span>
      </div>
      <ModuleSandbox info={info} {...props} />
    </div>
  )
}

type Msg = { bw: 1; id?: number; sub?: number; op: string; args?: Record<string, unknown> }

function ModuleSandbox({ info, pageId, settings, editable, onSettings }: WidgetBlockProps & { pageId: string; info: ModuleInfo }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(160)
  const srcdoc = useMemo(() => buildSrcdoc(info.code ?? '', CLIENT), [info.code])
  const latest = useRef({ settings, editable, onSettings })
  latest.current = { settings, editable, onSettings }
  const id = info.manifest.id

  const settingsKey = JSON.stringify(settings)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) frame.current?.contentWindow?.postMessage({ bw: 1, event: 'settings', settings }, '*')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey])
  // Follow theme edits too, not only the dark/light switch.
  const theme = useApp((s) => s.theme)
  const themes = useApp((s) => s.themes)
  const themeFor = useApp((s) => s.themeFor)
  useEffect(() => {
    if (started.current) requestAnimationFrame(() => frame.current?.contentWindow?.postMessage({ bw: 1, event: 'theme', theme: themeVars() }, '*'))
  }, [theme, themes, themeFor])

  useEffect(() => {
    const subs = new Map<number, { databaseId: string; view: unknown }>()
    const send = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ bw: 1, ...m }, '*')
    const runSub = (sub: number) => {
      const s = subs.get(sub)
      if (!s) return
      moduleCall(id, 'db.query', s).then(
        (result) => subs.has(sub) && send({ event: 'data', sub, result }),
        (e) => subs.has(sub) && send({ event: 'data', sub, result: null, error: message(e) }),
      )
    }
    const writes = new Set(['db.create', 'db.setProperty', 'db.createRow', 'db.setValue', 'props.set', 'fs.pickFolder', 'setSettings'])

    const handle = async (m: Msg): Promise<unknown> => {
      const a = m.args ?? {}
      if (writes.has(m.op) && !latest.current.editable) throw new Error('This page is read-only')
      switch (m.op) {
        case 'fs.pickFolder':
          return chooseFolderFor(id, String(a.title || `Choose a folder for ${info.manifest.name}`))
        case 'db.create':
          return moduleCall(id, 'db.create', { title: a.title, icon: a.icon, parentId: pageId })
        case 'props.get':
        case 'props.set':
          await flushAll()
          return moduleCall(id, m.op, { ...a, pageId: a.pageId || pageId })
        case 'setSettings': {
          const next = a.settings
          if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('settings must be an object')
          latest.current.onSettings(next as Record<string, unknown>)
          return null
        }
        case 'fs.roots':
        case 'fs.list':
        case 'fs.readText':
        case 'fs.open':
        case 'db.setProperty':
        case 'db.query':
        case 'db.createRow':
        case 'db.setValue':
          return moduleCall(id, m.op, a)
      }
      throw new Error(`unknown call ${m.op}`)
    }

    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const m = e.data as Msg
      if (!m || m.bw !== 1 || typeof m.op !== 'string') return
      switch (m.op) {
        case 'hello':
          started.current = true
          subs.clear()
          send({
            event: 'init',
            module: { id, name: info.manifest.name, namespace: info.manifest.namespace },
            pageId,
            settings: latest.current.settings,
            editable: latest.current.editable,
            theme: themeVars(),
          })
          return
        case 'resize': {
          const h = Number(m.args?.height)
          if (Number.isFinite(h)) setHeight(Math.max(32, Math.min(2400, Math.ceil(h))))
          return
        }
        case 'db.subscribe':
          if (typeof m.sub !== 'number') return
          subs.set(m.sub, { databaseId: String(m.args?.databaseId), view: m.args?.view })
          runSub(m.sub)
          return
        case 'db.unsubscribe':
          if (typeof m.sub === 'number') subs.delete(m.sub)
          return
        case 'openPage':
          if (typeof m.args?.id === 'string') openWhenKnown(m.args.id)
          return
      }
      if (typeof m.id !== 'number') return
      handle(m).then(
        (result) => send({ id: m.id, ok: true, result: result ?? null }),
        (err) => send({ id: m.id, ok: false, error: message(err) }),
      )
    }
    window.addEventListener('message', onMessage)

    let t: ReturnType<typeof setTimeout> | undefined
    const off = coreClient().onEvent((e) => {
      // Files changed in one of this module's folders.
      if (e.type === 'fsChanged') {
        if (e.moduleId === id) send({ event: 'fs', root: e.root })
        return
      }
      clearTimeout(t)
      t = setTimeout(() => subs.forEach((_, sub) => runSub(sub)), 80)
    })
    return () => {
      window.removeEventListener('message', onMessage)
      off()
      clearTimeout(t)
      subs.clear()
    }
  }, [id, info.manifest.name, info.manifest.namespace, pageId])

  return <iframe ref={frame} className="widget-iframe" title={info.manifest.name} sandbox="allow-scripts" srcDoc={srcdoc} style={{ height }} />
}

/** A page the module just made reaches the app's page list a moment later: wait for it. */
function openWhenKnown(id: string, tries = 30) {
  if (getState().pages[id]) openPage(id, 'replace')
  else if (tries > 0) setTimeout(() => openWhenKnown(id, tries - 1), 100)
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, '')
}
