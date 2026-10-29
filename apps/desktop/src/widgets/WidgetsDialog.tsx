import { Blocks, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { setState, toast } from '../state/store'
import { installWidget, loadWidget, refreshWidgets, removeWidget, useInstalledWidgets, type Manifest } from './api'
import { manifestFromHtml } from './runtime'

/** Settings → "Widgets…": the installed widgets, and installing one from an .html file. */
export function WidgetsDialog() {
  const widgets = useInstalledWidgets()
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const close = () => setState({ widgetsDialog: false })

  const install = async (f: File) => {
    setError(null)
    try {
      const html = await f.text()
      const manifest = manifestFromHtml(html) as Manifest
      const existing = widgets.find((w) => w.manifest.id === manifest.id)
      if (existing?.builtin) throw new Error(`"${manifest.id}" is the id of a built-in widget; give yours another id.`)
      await installWidget(manifest, html)
      void loadWidget(manifest.id, true)
      await refreshWidgets()
      toast(`${existing ? 'Updated' : 'Installed'} ${manifest.name}`)
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="import-modal widgets-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Widgets">
        <div className="import-head">
          <strong>Widgets</strong>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <p>
          Widgets are small apps you put in a page with <code>/</code>. Each one runs in a sandbox and only sees the
          databases and columns you connect it to. See <code>docs/widgets.md</code> to write your own.
        </p>
        <div className="widgets-list">
          {widgets.map((w) => (
            <div className="widgets-item" key={w.manifest.id}>
              <span className="widgets-icon">{w.manifest.icon || <Blocks size={15} />}</span>
              <div className="widgets-text">
                <strong>
                  {w.manifest.name}
                  {w.builtin && <span className="widgets-tag">built-in</span>}
                </strong>
                <span>{w.manifest.description || w.manifest.id}</span>
              </div>
              {!w.builtin && (
                <button
                  className="icon-btn"
                  title="Uninstall (blocks using it stay in their pages)"
                  onClick={() =>
                    void removeWidget(w.manifest.id).then(refreshWidgets, (e) => setError(String(e)))
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {error && <div className="import-failed">{error}</div>}
        <input
          ref={file}
          type="file"
          accept=".html,text/html"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void install(f)
          }}
        />
        <div className="import-actions">
          <button className="primary-btn" onClick={() => file.current?.click()}>
            <Upload size={13} /> Install from file…
          </button>
        </div>
      </div>
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}
