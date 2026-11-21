import type { WidgetBlockProps } from '@brainwaves/editor'
import { Archive, BookmarkCheck, ExternalLink } from 'lucide-react'
import { openExternal } from '../lib/storage'
import { burrowLinks, domainOf, getBookmark, useBurrow, useBurrowData } from './api'

/**
 * A Burrow bookmark in a page (`burrow:card`, settings `{ id, url, title }`). The card shows the
 * bookmark as Burrow has it now: title, picture, description, tags. Offline, it falls back to
 * the title and link it was saved with.
 */
export function BurrowCard({ settings }: WidgetBlockProps) {
  const conn = useBurrow()
  const id = Number(settings.id)
  const { data: b, error, loading } = useBurrowData(conn && id ? () => getBookmark(id) : null, [conn?.url, id])
  const url = b?.url ?? (settings.url as string | null) ?? null
  const title = b?.title || (settings.title as string) || url || 'Bookmark'
  const open = (u: string) => void openExternal(u)
  return (
    <div className={`bc ${b?.image_url ? 'with-image' : ''}`}>
      <div className="bc-body">
        <div className="bc-site">
          {b?.favicon && <img src={b.favicon} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
          <span>{b?.site_name || domainOf(url) || (b?.type === 'note' ? 'Note in Burrow' : 'Burrow')}</span>
        </div>
        <button className="bc-title" onClick={() => url && open(url)} title={url ?? undefined}>
          {title}
        </button>
        {b?.description && <p className="bc-desc">{b.description}</p>}
        {b?.type === 'note' && b.note && <p className="bc-desc">{b.note.slice(0, 280)}</p>}
        {!!b?.tags?.length && (
          <div className="bc-tags">
            {b.tags.slice(0, 8).map((t) => (
              <span key={t.name} className={t.source === 'ai' ? 'ai' : ''}>
                {t.source === 'ai' ? '✦ ' : '#'}
                {t.name}
              </span>
            ))}
          </div>
        )}
        <div className="bc-actions">
          {url && (
            <button onClick={() => open(url)}>
              <ExternalLink size={12} /> Open
            </button>
          )}
          {conn && b && (
            <button onClick={() => open(burrowLinks(conn.url, b).item)} title="See it in Burrow (reader view, notes, archive)">
              <BookmarkCheck size={12} /> In Burrow
            </button>
          )}
          {conn && b && !!b.has_archive && (
            <button onClick={() => open(burrowLinks(conn.url, b).archive)} title="The copy Burrow archived">
              <Archive size={12} /> Archived copy
            </button>
          )}
          {!conn && conn !== undefined && <span className="bc-note">Connect Burrow to see this bookmark live.</span>}
          {conn && error && <span className="bc-note">{error}</span>}
          {conn && loading && !b && <span className="bc-note">Loading from Burrow…</span>}
        </div>
      </div>
      {b?.image_url && <img className="bc-image" src={b.image_url} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
    </div>
  )
}
