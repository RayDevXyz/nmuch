import { ScrollText, Upload, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { toast, useApp } from '../state/store'
import { campaignOf, campaigns, KIND_LABEL, publishedState, publishPage, unpublishPage, type JournalKind, type Published } from './hub'

/** "Publish to table": a page into a campaign's journal on the players' hub. */

let current: string | null = null
const subs = new Set<() => void>()
export function openPublish(pageId: string) {
  current = pageId
  subs.forEach((f) => f())
}
const close = () => openPublish(null as never)

export function PublishHost() {
  const id = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current,
  )
  return id ? <PublishDialog key={id} pageId={id} /> : null
}

const guessKind = (title: string): JournalKind => (/session|log|day\b|expedition|recap/i.test(title) ? 'log' : /story|so far|chronicle|saga|history/i.test(title) ? 'story' : 'page')

function PublishDialog({ pageId }: { pageId: string }) {
  const page = useApp((s) => s.pages[pageId])
  const list = campaigns()
  const [state, setState] = useState<Published | null | undefined>(undefined)
  const [campaign, setCampaign] = useState(campaignOf(pageId) ?? list[0]?.id ?? '')
  const [kind, setKind] = useState<JournalKind>(guessKind(page?.title ?? ''))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void publishedState(pageId).then((s) => {
      setState(s)
      if (s) {
        setCampaign(s.campaignId)
        setKind(s.kind)
      }
    })
  }, [pageId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = async (what: 'publish' | 'unpublish') => {
    setBusy(true)
    try {
      if (what === 'publish') {
        await publishPage(pageId, campaign, kind)
        toast(state ? 'Updated on the table' : `Published to ${list.find((c) => c.id === campaign)?.title ?? 'the table'}`)
      } else {
        await unpublishPage(pageId)
        toast('Taken off the table')
      }
      close()
      window.dispatchEvent(new Event('focus'))
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="account tpl-dialog" role="dialog" aria-label="Publish to table">
        <header>
          <span>
            <ScrollText size={15} /> Publish to table
          </span>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <section>
          {list.length === 0 ? (
            <p className="account-hint">There's no campaign yet. Make one with /campaign, then publish its pages to the players' table.</p>
          ) : (
            <>
              <p className="account-hint">
                <b>{page?.title || 'Untitled'}</b> goes into the campaign's journal on the players' hub, as it is now. Links to other pages
                show as their titles; 5e cards open in the players' compendium; databases and buttons stay in BrainWaves.
                {state && ` Published ${new Date(state.at).toLocaleString()}: publish again after you edit it.`}
              </p>
              <label className="sync-field">
                <span>Campaign</span>
                <select value={campaign} onChange={(e) => setCampaign(e.target.value)} disabled={!!state}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sync-modes" role="radiogroup" aria-label="Kind">
                {(Object.keys(KIND_LABEL) as JournalKind[]).map((k) => (
                  <label key={k} className={kind === k ? 'on' : ''}>
                    <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                    <span>
                      <b>{KIND_LABEL[k]}</b>
                      <small>{k === 'log' ? 'What happened in a session or an expedition.' : k === 'story' ? 'Where the story stands: the big picture.' : 'A handout, a map, a letter, anything else.'}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="sync-actions">
                <button className="setting-action primary" disabled={busy || !campaign} onClick={() => void run('publish')}>
                  <Upload size={13} /> {state ? 'Update on the table' : 'Publish'}
                </button>
                {state && (
                  <button className="setting-action" disabled={busy} onClick={() => void run('unpublish')}>
                    Unpublish
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
