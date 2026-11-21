import { BookmarkCheck } from 'lucide-react'
import { openExternal } from '../lib/storage'
import { domainOf, dragBookmark, listBookmarks, useBurrow, useBurrowData } from './api'

/** Under a BrainWaves #tag: the Burrow bookmarks with the same tag (nested tags included). */
export function BurrowTagItems({ tag }: { tag: string }) {
  const conn = useBurrow()
  const { data, error } = useBurrowData(conn ? () => listBookmarks({ tag, limit: 30 }) : null, [conn?.url, tag])
  if (!conn || (!error && !data?.items.length)) return null
  return (
    <>
      <div className="sidebar-section-title">
        <span>
          <BookmarkCheck size={11} /> In Burrow
        </span>
        <span className="count">{data?.items.length ?? ''}</span>
      </div>
      {error && <div className="sidebar-empty">{error}</div>}
      <ul className="bw-list compact">
        {(data?.items ?? []).map((b) => (
          <li key={b.id} className="bw-row" draggable onDragStart={(e) => dragBookmark(e, b)} onClick={() => b.url && void openExternal(b.url)} title={b.url ?? ''}>
            <span className="bw-fav">{b.favicon ? <img src={b.favicon} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <BookmarkCheck size={13} />}</span>
            <span className="bw-text">
              <b>{b.title || b.url}</b>
              <small>{b.type === 'note' ? 'Note' : domainOf(b.url)}</small>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
