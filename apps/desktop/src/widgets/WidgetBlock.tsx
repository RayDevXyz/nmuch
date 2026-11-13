import type { WidgetBlockProps } from '@brainwaves/editor'
import { Blocks, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { coreClient } from '../lib/storage'
import { openPage } from '../state/actions'
import { useApp } from '../state/store'
import { BindingSetup } from './BindingSetup'
import { ModuleBlock } from '../modules/ModuleBlock'
import { DndBlock } from '../dnd/DndBlock'
import { buildSrcdoc, themeVars } from './runtime'
import {
  loadWidget,
  widgetCreateRow,
  widgetMutate,
  widgetQuery,
  type Binding,
  type Instance,
  type Manifest,
  type WidgetDef,
  type WidgetQuery,
} from './api'

/** Every required slot has a database and every required field a column. */
export function bindingsComplete(manifest: Manifest, bindings: Record<string, unknown>): boolean {
  return Object.entries(manifest.slots).every(([slot, spec]) => {
    const b = bindings[slot] as Binding | undefined
    if (!b?.databaseId) return false
    return Object.entries(spec.fields).every(([key, f]) => f.optional || !!b.fields?.[key])
  })
}

/**
 * A widget instance in a page: the widget's HTML in a sandboxed iframe (scripts only: no
 * same-origin, no network by CSP), talking to this component by postMessage. Calls are sent to
 * the core as this block (`pageId` + `blockId`), and the core checks them against the bindings
 * stored on the block, so the widget can't name another database or column.
 */
export function WidgetBlock(props: WidgetBlockProps & { pageId: string }) {
  // A third-party module placed in the page uses the same block, as `module:<id>`.
  if (props.widgetId.startsWith('module:')) return <ModuleBlock {...props} moduleId={props.widgetId.slice(7)} />
  // First-party D&D blocks (compendium cards, …) use it too, as `dnd:<kind>`.
  if (props.widgetId.startsWith('dnd:')) return <DndBlock {...props} kind={props.widgetId.slice(4)} />
  return <WidgetInstance {...props} />
}

function WidgetInstance(props: WidgetBlockProps & { pageId: string }) {
  const { widgetId, bindings, editable, onBindings } = props
  const [def, setDef] = useState<WidgetDef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState(false)

  useEffect(() => {
    let live = true
    setError(null)
    loadWidget(widgetId).then(
      (d) => live && setDef(d),
      (e) => live && setError(String(e)),
    )
    return () => {
      live = false
    }
  }, [widgetId])

  if (error) return <div className="widget-missing">Widget “{widgetId}” is not installed.</div>
  if (!def) return <div className="widget-loading" />

  const ready = bindingsComplete(def.manifest, bindings)
  if (configuring || !ready) {
    if (!editable) return <div className="widget-missing">{def.manifest.name} is not set up yet.</div>
    return (
      <BindingSetup
        manifest={def.manifest}
        pageId={props.pageId}
        bindings={bindings as Record<string, Binding>}
        onCancel={ready ? () => setConfiguring(false) : undefined}
        onSave={(b) => {
          onBindings(b)
          setConfiguring(false)
        }}
      />
    )
  }

  return (
    <div className="widget-frame">
      <div className="widget-bar">
        <span className="widget-name">
          {def.manifest.icon ? <span>{def.manifest.icon}</span> : <Blocks size={13} />}
          {def.manifest.name}
        </span>
        {editable && (
          <button className="icon-btn" title="Connect to databases" onClick={() => setConfiguring(true)}>
            <Settings2 size={14} />
          </button>
        )}
      </div>
      {/* A new binding is a new instance as far as the widget is concerned: remount it. */}
      <Sandbox key={JSON.stringify(bindings)} def={def} {...props} />
    </div>
  )
}

type Msg = { bw: 1; id?: number; sub?: number; op: string; args?: Record<string, unknown> }

function Sandbox({ def, pageId, blockId, settings, editable, onSettings }: WidgetBlockProps & { pageId: string; def: WidgetDef }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(def.manifest.height ?? 120)
  const srcdoc = useMemo(() => buildSrcdoc(def.html ?? ''), [def.html])

  // Values the message handler reads without re-subscribing.
  const latest = useRef({ settings, editable, onSettings })
  latest.current = { settings, editable, onSettings }

  // Tell the widget when its settings change (another window, or its own setSettings).
  const settingsKey = JSON.stringify(settings)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) frame.current?.contentWindow?.postMessage({ bw: 1, event: 'settings', settings }, '*')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey])

  // Follow the app's light/dark switch.
  const theme = useApp((s) => s.theme)
  useEffect(() => {
    if (started.current) requestAnimationFrame(() => frame.current?.contentWindow?.postMessage({ bw: 1, event: 'theme', theme: themeVars() }, '*'))
  }, [theme])

  useEffect(() => {
    const me: Instance = { pageId, blockId }
    const subs = new Map<number, { slot: string; query: WidgetQuery }>()
    // Rows the widget has been shown: the only ones it may ask to open.
    const seen = new Set<string>()
    const send = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ bw: 1, ...m }, '*')
    const remember = (r: unknown) => {
      for (const row of (r as { rows?: { id: string }[] })?.rows ?? []) seen.add(row.id)
      for (const id of Object.keys((r as { related?: Record<string, unknown> })?.related ?? {})) seen.add(id)
      return r
    }
    const runSub = (sub: number) => {
      const s = subs.get(sub)
      if (!s) return
      widgetQuery(me, s.slot, s.query).then(
        (result) => subs.has(sub) && send({ event: 'data', sub, result: remember(result) }),
        (e) => subs.has(sub) && send({ event: 'data', sub, result: null, error: message(e) }),
      )
    }

    const handle = async (m: Msg): Promise<unknown> => {
      const a = m.args ?? {}
      const writable = () => {
        if (!latest.current.editable) throw new Error('This page is read-only')
      }
      switch (m.op) {
        case 'query':
          return remember(await widgetQuery(me, String(a.slot), (a.query ?? {}) as WidgetQuery))
        case 'mutate':
          writable()
          return widgetMutate(me, String(a.slot), String(a.rowId), (a.values ?? {}) as Record<string, unknown>)
        case 'createRow': {
          writable()
          const id = await widgetCreateRow(me, String(a.slot), (a.values ?? {}) as Record<string, unknown>)
          seen.add(id)
          return id
        }
        case 'setSettings': {
          writable()
          const next = a.settings
          if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('settings must be an object')
          if (JSON.stringify(next).length > 64 * 1024) throw new Error('settings are too large')
          latest.current.onSettings(next as Record<string, unknown>)
          return null
        }
      }
      throw new Error(`unknown call ${m.op}`)
    }

    const onMessage = (e: MessageEvent) => {
      // Only this block's frame; the sandbox has an opaque origin, so its window is the identity.
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const m = e.data as Msg
      if (!m || m.bw !== 1 || typeof m.op !== 'string') return
      switch (m.op) {
        case 'hello':
          started.current = true
          subs.clear()
          send({
            event: 'init',
            slots: slotSummary(def.manifest),
            settings: latest.current.settings,
            editable: latest.current.editable,
            theme: themeVars(),
          })
          return
        case 'resize': {
          const h = Number(m.args?.height)
          if (Number.isFinite(h)) setHeight(Math.max(32, Math.min(2000, Math.ceil(h))))
          return
        }
        case 'subscribe':
          if (typeof m.sub !== 'number') return
          subs.set(m.sub, { slot: String(m.args?.slot), query: (m.args?.query ?? {}) as WidgetQuery })
          runSub(m.sub)
          return
        case 'unsubscribe':
          if (typeof m.sub === 'number') subs.delete(m.sub)
          return
        case 'openRow': {
          const id = String(m.args?.rowId ?? '')
          if (seen.has(id)) void openPage(id, 'replace')
          return
        }
      }
      if (typeof m.id !== 'number') return
      handle(m).then(
        (result) => send({ id: m.id, ok: true, result: result ?? null }),
        (err) => send({ id: m.id, ok: false, error: message(err) }),
      )
    }
    window.addEventListener('message', onMessage)

    // Live data: any committed change re-runs the subscriptions (a short debounce batches bursts).
    let t: ReturnType<typeof setTimeout> | undefined
    const off = coreClient().onEvent(() => {
      clearTimeout(t)
      t = setTimeout(() => subs.forEach((_, sub) => runSub(sub)), 80)
    })
    return () => {
      window.removeEventListener('message', onMessage)
      off()
      clearTimeout(t)
      subs.clear()
    }
  }, [def.manifest, pageId, blockId])

  return (
    <iframe
      ref={frame}
      className="widget-iframe"
      title={def.manifest.name}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      style={{ height }}
    />
  )
}

/** What a widget learns about its slots: access and which fields exist (no ids). */
function slotSummary(m: Manifest) {
  return Object.fromEntries(
    Object.entries(m.slots).map(([k, s]) => [k, { access: s.access, fields: Object.keys(s.fields) }]),
  )
}

function message(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  return s.replace(/^Error:\s*/, '')
}
