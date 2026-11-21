import { CloudOff, RefreshCw, Unplug, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { coreClient } from '../lib/storage'
import { relativeTime } from '../lib/time'
import { setState, toast, useApp } from '../state/store'

/**
 * Two-way sync with a BrainWaves server (desktop app): connect with the server's address and
 * an API token, then pages sync in the background. See `crates/bw-api/src/sync.rs`.
 */
export interface SyncStatus {
  connected: boolean
  url: string | null
  lastOk: number | null
  lastError: string | null
  lastReport: { sent: number; received: number; deletedHere: number; deletedThere: number } | null
  running: boolean
}

// Async all the way: early on (before storage is ready) this rejects instead of throwing.
const call = async <T,>(command: string, args: Record<string, unknown> = {}) => coreClient().call<T>(command, args)
const msg = (e: unknown) => String(e).replace(/^Error:\s*/, '')

/** The sync status, re-read every few seconds (null: this app can't sync, e.g. hosted). */
export function useSyncStatus(every = 5000): SyncStatus | null {
  const [st, setSt] = useState<SyncStatus | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      call<SyncStatus>('syncStatus').then(
        (s) => live && setSt(s),
        () => live && setSt(null),
      )
    void load()
    const t = setInterval(load, every)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [every])
  return st
}

const host = (url: string | null) => {
  try {
    return url ? new URL(url).host : ''
  } catch {
    return url ?? ''
  }
}

/** The chip in the top bar: synced / syncing / offline, opens the dialog. */
export function SyncChip() {
  const st = useSyncStatus()
  if (!st?.connected) return null
  const state = st.running ? 'busy' : st.lastError ? 'error' : 'ok'
  return (
    <button
      className={`sync-chip ${state}`}
      onClick={() => setState({ syncDialog: true })}
      title={st.lastError ? `Not synced: ${st.lastError}` : st.lastOk ? `Synced with ${host(st.url)} ${relativeTime(st.lastOk, Date.now())}` : 'Syncing…'}
    >
      {state === 'error' ? <CloudOff size={13} /> : <RefreshCw size={13} className={state === 'busy' ? 'spin' : ''} />}
      {state === 'error' ? 'Not synced' : state === 'busy' ? 'Syncing' : 'Synced'}
    </button>
  )
}

export function SyncDialog() {
  const open = useApp((s) => s.syncDialog)
  return open ? <SyncDialogBody /> : null
}

function SyncDialogBody() {
  const st = useSyncStatus(2000)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [check, setCheck] = useState<{ serverPages: number; localPages: number } | null>(null)
  const [mode, setMode] = useState<'merge' | 'server'>('merge')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const close = () => !busy && setState({ syncDialog: false })

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await f()
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(null)
    }
  }
  const doCheck = () =>
    run('Checking…', async () => {
      setCheck(await call('syncConnect', { url, token, check: true }))
    })
  const doConnect = () =>
    run('Syncing for the first time…', async () => {
      const r = await call<{ report: SyncStatus['lastReport'] }>('syncConnect', { url, token, mode })
      toast(`Connected: ${r.report?.received ?? 0} pages came in, ${r.report?.sent ?? 0} went out`)
      setCheck(null)
      setToken('')
    })

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="account sync-dialog" role="dialog" aria-label="Sync">
        <header>
          <span>
            <RefreshCw size={16} /> Sync with a server
          </span>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </header>
        {!st ? (
          <section>
            <p className="account-hint">Sync is available in the desktop app.</p>
          </section>
        ) : st.connected ? (
          <section>
            <p>
              Syncing with <b>{host(st.url)}</b>. Changes go both ways in the background, a few seconds after you make them; changes made elsewhere arrive within half a minute.
            </p>
            <div className={`sync-state ${st.lastError ? 'error' : ''}`}>
              {st.running ? (
                <span>Syncing now…</span>
              ) : st.lastError ? (
                <span>Not synced: {st.lastError}</span>
              ) : (
                <span>
                  Last synced {st.lastOk ? relativeTime(st.lastOk, Date.now()) : 'never'}
                  {st.lastReport && (st.lastReport.sent || st.lastReport.received || st.lastReport.deletedHere || st.lastReport.deletedThere)
                    ? ` · ${st.lastReport.sent} sent, ${st.lastReport.received} received${st.lastReport.deletedHere + st.lastReport.deletedThere ? `, ${st.lastReport.deletedHere + st.lastReport.deletedThere} deleted` : ''}`
                    : ''}
                </span>
              )}
            </div>
            {error && <div className="login-error">{error}</div>}
            <div className="sync-actions">
              <button className="setting-action" disabled={!!busy || st.running} onClick={() => run('Syncing…', async () => void (await call('syncNow')))}>
                <RefreshCw size={13} /> {busy ?? 'Sync now'}
              </button>
              <button
                className="setting-action"
                disabled={!!busy}
                onClick={() =>
                  confirm('Stop syncing? Your pages stay on this computer and on the server.') &&
                  run('Disconnecting…', async () => {
                    await call('syncDisconnect')
                    toast('Sync stopped')
                  })
                }
              >
                <Unplug size={13} /> Stop syncing
              </button>
            </div>
          </section>
        ) : (
          <section>
            <p className="account-hint">
              Keep this computer's pages and your BrainWaves server in sync, both ways. You can keep writing offline: changes sync when you're back. Edits made in both places merge.
            </p>
            <label className="sync-field">
              <span>Server address</span>
              <input value={url} placeholder="https://notes.example.com" onChange={(e) => (setUrl(e.target.value), setCheck(null))} />
            </label>
            <label className="sync-field">
              <span>API token</span>
              <input value={token} placeholder="bw_…" onChange={(e) => (setToken(e.target.value), setCheck(null))} />
              <small>On the server: Settings → Account and API tokens → New token.</small>
            </label>
            {error && <div className="login-error">{error}</div>}
            {!check ? (
              <button className="setting-action primary" disabled={!url.trim() || !token.trim() || !!busy} onClick={doCheck}>
                {busy ?? 'Continue'}
              </button>
            ) : (
              <>
                <p>
                  The server has <b>{check.serverPages}</b> page{check.serverPages === 1 ? '' : 's'}; this computer has <b>{check.localPages}</b>.
                </p>
                <div className="sync-modes" role="radiogroup">
                  <label className={mode === 'merge' ? 'on' : ''}>
                    <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                    <span>
                      <b>Keep both</b>
                      <small>This computer's pages go to the server, and the server's come here.</small>
                    </span>
                  </label>
                  <label className={mode === 'server' ? 'on' : ''}>
                    <input type="radio" checked={mode === 'server'} onChange={() => setMode('server')} />
                    <span>
                      <b>Use the server's pages</b>
                      <small>
                        The {check.localPages} page{check.localPages === 1 ? '' : 's'} on this computer {check.localPages === 1 ? 'is' : 'are'} removed first. Good for a fresh install.
                      </small>
                    </span>
                  </label>
                </div>
                <button className="setting-action primary" disabled={!!busy} onClick={doConnect}>
                  {busy ?? 'Connect and sync'}
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
