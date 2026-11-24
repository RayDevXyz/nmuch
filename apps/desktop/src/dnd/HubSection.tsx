import { BookOpen, RefreshCw, ScrollText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { openPage } from '../state/actions'
import { toast, useApp } from '../state/store'
import type { Category } from './fivee'
import { openCompendium } from './Compendium'
import { compendiumStatus, HUB_CATEGORIES, journalList, publishCompendium, removeCompendium, type CompendiumMeta, type JournalEntry } from './hub'

const clean = (e: unknown) => String(e).replace(/^Error:\s*/, '')
const CATS_KEY = (id: string) => `bw.hubCats.${id}`
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * The players' hub: the compendium players browse (from the books turned on in the compendium's
 * settings, never monsters) and the journal pages published from this campaign.
 */
export function HubSection({ campaignId }: { campaignId: string }) {
  const [meta, setMeta] = useState<CompendiumMeta | null | undefined>(undefined)
  const [cats, setCats] = useState<Category[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CATS_KEY(campaignId)) || 'null')
      if (Array.isArray(saved)) return saved
    } catch {
      /* default */
    }
    return HUB_CATEGORIES.map((c) => c.id)
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const pages = useApp((s) => s.pages)

  const refresh = () => {
    compendiumStatus(campaignId).then(setMeta, () => setMeta(null))
    journalList(campaignId).then(setJournal, () => setJournal([]))
  }
  useEffect(() => {
    refresh()
    // Pages are published from elsewhere (a page's ⋯ menu): look again now and then, and on focus.
    const t = setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', refresh)
    }
  }, [campaignId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (c: Category) => {
    const next = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]
    setCats(next)
    try {
      localStorage.setItem(CATS_KEY(campaignId), JSON.stringify(next))
    } catch {
      /* not remembered */
    }
  }
  const publish = async () => {
    if (!cats.length) return toast('Choose at least one kind of entry')
    setBusy('Starting…')
    try {
      const m = await publishCompendium(campaignId, cats, setBusy)
      setMeta(m)
      const n = Object.values(m.counts ?? {}).reduce((a, b) => a + b, 0)
      toast(`Published ${n} entries to the players’ compendium`)
    } catch (e) {
      toast(`Could not publish: ${clean(e)}`)
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    setBusy('Removing…')
    try {
      await removeCompendium(campaignId)
      setMeta(null)
    } catch (e) {
      toast(clean(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <section className="sc-sec">
        <h3>
          <BookOpen size={13} /> Players’ compendium
          {meta && <small>{when(meta.publishedAt)}</small>}
        </h3>
        <p className="sc-hint">
          Players browse your 5etools content on the table site, without your 5etools running. It uses the books turned on in the compendium’s
          settings (<button className="sc-linkbtn" onClick={() => openCompendium()}>choose books</button>). Monsters are never sent.
        </p>
        <div className="sc-chips">
          {HUB_CATEGORIES.map((c) => (
            <label key={c.id} className={`sc-chip ${cats.includes(c.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={cats.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.label}
              {meta?.counts?.[c.id] != null && <small>{meta.counts[c.id]}</small>}
            </label>
          ))}
        </div>
        <div className="sc-row">
          <button className="sc-btn gold" disabled={!!busy} onClick={() => void publish()}>
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> {meta ? 'Publish again' : 'Publish compendium'}
          </button>
          {meta && (
            <button className="sc-btn" disabled={!!busy} onClick={() => void remove()} title="Take the compendium off the table site">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {busy && <p className="sc-hint">{busy}</p>}
        {meta && !busy && <p className="sc-hint">From {meta.sources.length} book{meta.sources.length === 1 ? '' : 's'}: {meta.sources.slice(0, 12).join(', ')}{meta.sources.length > 12 ? '…' : ''}</p>}
      </section>
      <section className="sc-sec">
        <h3>
          <ScrollText size={13} /> Journal
          <small>{journal.length} published</small>
        </h3>
        <p className="sc-hint">Expedition logs, the story so far, handouts: open any page and choose <b>Publish to table</b> in its ⋯ menu.</p>
        {journal.length > 0 && (
          <ul className="sc-journal">
            {journal.map((j) => (
              <li key={j.id}>
                <button className="sc-linkbtn" onClick={() => pages[j.id] && openPage(j.id, 'tab')}>
                  {j.title || 'Untitled'}
                </button>
                <small>{j.kind === 'log' ? 'log' : j.kind === 'story' ? 'story' : 'page'}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
