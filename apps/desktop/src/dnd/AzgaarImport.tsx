import { ExternalLink, FileJson, ImageIcon, Map as MapIcon, X } from 'lucide-react'
import { useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { fitCanvas, fitImage } from '../edgeless/Canvas'
import { openExternal } from '../lib/storage'
import { setState, toast } from '../state/store'
import { refreshRoles } from './api'
import { AZGAAR_URL, chooseCities, importWorld, parseAzgaar, type CityChoice, type Parsed } from './azgaar'
import { openSoon } from './Campaign'

/** "Import from Azgaar": the generator's JSON export (+ its picture) into a campaign. */

let request: { campaignId: string } | null = null
const listeners = new Set<() => void>()
const set = (r: typeof request) => {
  request = r
  listeners.forEach((l) => l())
}
export const openAzgaarImport = (campaignId: string) => set({ campaignId })

export function AzgaarImportHost() {
  const r = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => request)
  return r ? <AzgaarImport campaignId={r.campaignId} close={() => set(null)} /> : null
}

function AzgaarImport({ campaignId, close }: { campaignId: string; close: () => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [jsonName, setJsonName] = useState('')
  const [image, setImage] = useState<{ src: string; name: string; w: number; h: number } | null>(null)
  const [cities, setCities] = useState<CityChoice>('major')
  const [landmarks, setLandmarks] = useState(true)
  const [religions, setReligions] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const jsonInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const readJson = async (f: File) => {
    setError(null)
    try {
      setParsed(parseAzgaar(await f.text()))
      setJsonName(f.name)
    } catch (e) {
      setParsed(null)
      setError(String(e).replace(/^Error:\s*/, ''))
    }
  }
  const readImage = async (f: File) => {
    setError(null)
    try {
      const img = await fitImage(f)
      setImage({ ...img, name: f.name })
    } catch (e) {
      setError(`The picture could not be read: ${String(e).replace(/^Error:\s*/, '')}`)
    }
  }

  const chosen = parsed ? chooseCities(parsed.burgs, cities) : []
  const run = async () => {
    if (!parsed) return
    setBusy(true)
    setError(null)
    try {
      const r = await importWorld(campaignId, {
        name: parsed.name,
        width: parsed.width,
        height: parsed.height,
        image: image?.src,
        regions: parsed.states,
        places: [...chosen, ...(landmarks ? parsed.markers : [])],
        factions: religions ? parsed.religions : [],
      })
      await refreshRoles()
      close()
      toast(`${parsed.name}: ${r.created} new places, ${r.updated} updated, ${r.pins} pins${r.factions ? `, ${r.factions} factions` : ''}`)
      // Show the result: the map as a canvas, fitted to the new picture.
      setState((s) => ({ edgeless: { ...s.edgeless, [r.map]: true } }))
      openSoon(r.map, true)
      setTimeout(() => fitCanvas(r.map), 600)
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={() => !busy && close()}>
      <div className="fv-compendium cw az dnd-theme" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Import from Azgaar">
        <header className="fv-comp-head">
          <MapIcon size={18} />
          <span className="fv-comp-title">A world from Azgaar</span>
          <button className="fv-icon" aria-label="Close" onClick={close} disabled={busy}>
            <X size={16} />
          </button>
        </header>
        <div className="cw-body">
          <section className="cw-step">
            <h3>I · Make your world</h3>
            <p className="az-p">
              Generate and shape a world in <strong>Azgaar's Fantasy Map Generator</strong>. When it looks right, open its{' '}
              <em>Export</em> menu and save two files: the map as <strong>PNG</strong> (or SVG), and the world as{' '}
              <strong>JSON</strong> (full or minimal).
            </p>
            <button className="fv-btn" onClick={() => void openExternal(AZGAAR_URL)}>
              <ExternalLink size={13} /> Open the generator
            </button>
          </section>
          <section className="cw-step">
            <h3>II · Bring it in</h3>
            <div className="az-files">
              <button className={`az-file ${parsed ? 'ok' : ''}`} onClick={() => jsonInput.current?.click()}>
                <FileJson size={22} />
                <strong>World data (.json)</strong>
                <span>{jsonName || 'Required: states, cities, landmarks'}</span>
              </button>
              <button className={`az-file ${image ? 'ok' : ''}`} onClick={() => imageInput.current?.click()}>
                {image ? <img src={image.src} alt="" /> : <ImageIcon size={22} />}
                <strong>Map picture (.png, .svg)</strong>
                <span>{image ? `${image.name} · ${image.w}×${image.h}` : 'Recommended: the background with pins on it'}</span>
              </button>
            </div>
            <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && void readJson(e.target.files[0]), (e.target.value = ''))} />
            <input ref={imageInput} type="file" accept="image/*,.svg" hidden onChange={(e) => (e.target.files?.[0] && void readImage(e.target.files[0]), (e.target.value = ''))} />
          </section>
          {parsed && (
            <section className="cw-step">
              <h3>III · What becomes part of the campaign</h3>
              <p className="az-p">
                <strong>{parsed.name}</strong>, {parsed.width}×{parsed.height}: {parsed.states.length} realms, {parsed.burgs.length} settlements, {parsed.markers.length} landmarks,{' '}
                {parsed.religions.length} religions.
              </p>
              <div className="az-options">
                <label>
                  <span>Settlements</span>
                  <select value={cities} onChange={(e) => setCities(e.target.value as CityChoice)}>
                    <option value="major">Capitals, ports and the 60 largest ({chooseCities(parsed.burgs, 'major').length})</option>
                    <option value="capitals">Capitals only ({chooseCities(parsed.burgs, 'capitals').length})</option>
                    <option value="all">All of them ({parsed.burgs.length})</option>
                    <option value="none">None</option>
                  </select>
                </label>
                <label className="az-check">
                  <input type="checkbox" checked={landmarks} onChange={(e) => setLandmarks(e.target.checked)} /> Landmarks with their notes ({parsed.markers.length})
                </label>
                <label className="az-check">
                  <input type="checkbox" checked={religions} onChange={(e) => setReligions(e.target.checked)} /> Religions as factions ({parsed.religions.length})
                </label>
              </div>
              <p className="az-p small">
                Realms become <em>regions</em> in Locations; settlements become <em>cities</em> and <em>villages</em> with a pin on the map; landmarks
                get pins too. Importing again later updates names, pins and the picture, and never touches what you wrote on those pages.
              </p>
            </section>
          )}
          {error && <div className="fv-error">{error}</div>}
        </div>
        <footer className="cw-foot">
          <span className="cw-summary">
            {parsed
              ? `${parsed.states.length + chosen.length + (landmarks ? parsed.markers.length : 0)} places${image ? ', with the map picture' : ', no picture (pins only)'}`
              : 'Choose the JSON export to see what is in it.'}
          </span>
          <button className="fv-btn gold" disabled={!parsed || busy} onClick={() => void run()}>
            {busy ? 'Importing…' : 'Import world'}
          </button>
        </footer>
      </div>
    </div>,
    document.querySelector('.workspace') ?? document.body,
  )
}
