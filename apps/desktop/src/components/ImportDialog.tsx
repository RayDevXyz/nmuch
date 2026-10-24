import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import { describeImport, importNimbus, nimbusDefaultPath, type ImportProgress, type ImportResult } from '../lib/nimbus-import'
import { setState, toast } from '../state/store'

/** Settings → "Import from Nimbus…": copy pages from an old `nimbus.db` into this workspace. */
export function ImportDialog() {
  const [path, setPath] = useState('')
  const [detected, setDetected] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = !!progress && !result && !error
  const close = () => !running && setState({ importDialog: false })

  useEffect(() => {
    nimbusDefaultPath()
      .then((p) => {
        setDetected(!!p)
        if (p) setPath(p)
      })
      .catch(() => setDetected(false))
  }, [])

  const run = async () => {
    setError(null)
    setResult(null)
    setProgress({ done: 0, total: 0, title: '' })
    try {
      const r = await importNimbus(path.trim(), setProgress)
      setResult(r)
      toast(describeImport(r))
    } catch (e) {
      setError(String(e))
      setProgress(null)
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="import-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Import from Nimbus">
        <div className="import-head">
          <strong>Import from Nimbus</strong>
          <button className="icon-btn" aria-label="Close" onClick={close} disabled={running}>
            <X size={15} />
          </button>
        </div>
        <p className="muted-text small">
          Copies every page from an old Nimbus database into this workspace: content, the page tree, icons, favorites,
          archive, trash and dates. The Nimbus file is only read, never changed. Pages that are already here are skipped,
          so it's safe to run again.
        </p>
        <label className="import-label" htmlFor="nimbus-path">
          Nimbus database {detected === true && <span className="import-found">found</span>}
        </label>
        <input
          id="nimbus-path"
          className="import-path"
          placeholder={detected === false ? 'Path to nimbus.db (e.g. %APPDATA%\\app.nimbus.notes\\nimbus.db)' : '…'}
          value={path}
          disabled={running}
          spellCheck={false}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && path.trim() && !running && run()}
        />
        {progress && !result && (
          <div className="import-progress">
            <div className="import-bar">
              <div style={{ width: progress.total ? `${(100 * progress.done) / progress.total}%` : '0%' }} />
            </div>
            <span>
              {progress.total ? `${progress.done} / ${progress.total}` : 'Reading…'} {progress.title}
            </span>
          </div>
        )}
        {result && (
          <div className="import-result">
            <strong>{describeImport(result)}</strong>
            {result.failed.map((f, i) => (
              <div key={i} className="import-failed">
                {f.title}: {f.error}
              </div>
            ))}
          </div>
        )}
        {error && <div className="import-failed">{error}</div>}
        <div className="import-actions">
          {result ? (
            <button className="primary-btn" onClick={close}>
              Done
            </button>
          ) : (
            <button className="primary-btn" disabled={!path.trim() || running} onClick={run}>
              <Download size={14} /> {running ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}
