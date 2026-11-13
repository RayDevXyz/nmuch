import type { WidgetBlockProps } from '@brainwaves/editor'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { CATEGORIES, type Ref } from './fivee'
import { openCompendium, useEntry } from './Compendium'
import { OpenRef } from './render'
import { Statblock } from './Statblock'

/**
 * First-party D&D blocks in a page: a `widget` block whose widget is `dnd:<kind>`.
 *
 * - `dnd:card`: a 5e entry from the compendium (`settings` = `{ cat, name, source }`). Only the
 *   reference is stored; the text comes from the user's 5etools each time.
 */
export function DndBlock(props: WidgetBlockProps & { pageId: string; kind: string }) {
  if (props.kind === 'card') return <CardBlock {...props} />
  return <div className="widget-missing">Unknown D&D block “{props.kind}”.</div>
}

function CardBlock({ settings, editable, onSettings }: WidgetBlockProps) {
  const ref = isRef(settings) ? settings : null
  const { entry, error, loading } = useEntry(ref)
  const collapsed = settings.collapsed === true
  const cat = ref ? CATEGORIES.find((c) => c.id === ref.cat) : undefined
  return (
    <div className="dnd-card-block">
      <div className="dnd-card-bar">
        <button
          className="fv-icon"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={() => editable && onSettings({ ...settings, collapsed: !collapsed })}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="dnd-card-label">
          {cat?.icon} {ref?.name ?? 'Compendium entry'}
        </span>
        <button className="fv-icon" title="Open in the compendium" aria-label="Open in the compendium" onClick={() => ref && openCompendium({ open: ref })}>
          <BookOpen size={14} />
        </button>
      </div>
      {!collapsed &&
        (entry ? (
          <OpenRef.Provider value={(r) => openCompendium({ open: r })}>
            <Statblock entry={entry} compact />
          </OpenRef.Provider>
        ) : (
          <div className="widget-missing">{loading ? 'Loading from 5etools…' : error}</div>
        ))}
    </div>
  )
}

function isRef(s: Record<string, unknown>): s is Record<string, unknown> & Ref {
  return typeof s.cat === 'string' && typeof s.name === 'string'
}
