import { FolderPlus, Puzzle, ShieldCheck, ShieldOff, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { setState, toast } from '../state/store'
import { manifestFromHtml } from '../widgets/runtime'
import {
  approveModule,
  chooseFolderFor,
  describeCapability,
  installModule,
  refreshModules,
  refreshTrackers,
  removeModule,
  revokeFolder,
  revokeModule,
  useModules,
  type ModuleInfo,
  type ModuleManifest,
} from './api'

/**
 * Settings → "Modules…": what each module may do, the folders it was given, approving and
 * revoking, and installing a module from an .html file.
 */
export function ModulesDialog() {
  const modules = useModules()
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const close = () => setState({ modulesDialog: false })

  const run = (p: Promise<unknown>, done?: string) =>
    p.then(
      () => {
        setError(null)
        if (done) toast(done)
        void refreshTrackers()
        return refreshModules()
      },
      (e) => setError(String(e).replace(/^Error:\s*/, '')),
    )

  const install = async (f: File) => {
    try {
      const html = await f.text()
      const manifest = manifestFromHtml(html, 'module') as ModuleManifest
      await run(installModule(manifest, html), `Installed ${manifest.name}: review what it asks for, then approve it`)
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="import-modal widgets-modal modules-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Modules">
        <div className="import-head">
          <strong>Modules</strong>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <p>
          Modules add logic that works on your pages and files. Each one can only do what it lists below, once you approve it,
          and only in folders you choose for it. See <code>docs/develop/modules.md</code> to write your own.
        </p>
        <div className="widgets-list">
          {modules.map((m) => (
            <ModuleRow key={m.manifest.id} m={m} run={run} />
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

function ModuleRow({ m, run }: { m: ModuleInfo; run: (p: Promise<unknown>, done?: string) => Promise<unknown> }) {
  const id = m.manifest.id
  const canPick = m.manifest.capabilities.includes('fs.pick')
  return (
    <div className={`module-item ${m.approved ? '' : 'pending'}`} data-module={id}>
      <div className="widgets-item">
        <span className="widgets-icon">{m.manifest.icon || <Puzzle size={15} />}</span>
        <div className="widgets-text">
          <strong>
            {m.manifest.name}
            {m.builtin && <span className="widgets-tag">built-in</span>}
            <span className={`module-status ${m.approved ? 'ok' : 'wait'}`}>{m.approved ? 'Approved' : 'Needs approval'}</span>
          </strong>
          <span>{m.manifest.description || id}</span>
        </div>
        {!m.builtin && (
          <button className="icon-btn" title="Uninstall (what it made stays)" aria-label="Uninstall" onClick={() => void run(removeModule(id), `Uninstalled ${m.manifest.name}`)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <ul className="module-caps">
        {m.manifest.capabilities.length === 0 && <li>Only its own page properties ({m.manifest.namespace}.*)</li>}
        {m.manifest.capabilities.map((c) => (
          <li key={c} className={m.pending.includes(describeCapability(c)) ? 'pending' : ''}>
            {describeCapability(c)}
          </li>
        ))}
      </ul>
      {m.folders.length > 0 && (
        <div className="module-folders">
          {m.folders.map((f) => (
            <span key={f} className="module-folder" title={f}>
              📁 {f}
              <button aria-label={`Remove ${f}`} title="Take this folder away" onClick={() => void run(revokeFolder(id, f))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="module-actions">
        {!m.approved && (
          <button className="primary-btn" onClick={() => void run(approveModule(id), `${m.manifest.name} approved`)}>
            <ShieldCheck size={13} /> Approve
          </button>
        )}
        {m.approved && canPick && (
          <button className="ghost-btn" onClick={() => void run(chooseFolderFor(id, `Choose a folder for ${m.manifest.name}`))}>
            <FolderPlus size={13} /> Add folder
          </button>
        )}
        {m.approved && !m.builtin && (
          <button className="ghost-btn" onClick={() => void run(revokeModule(id), `${m.manifest.name} can't do anything now`)}>
            <ShieldOff size={13} /> Revoke
          </button>
        )}
      </div>
    </div>
  )
}
