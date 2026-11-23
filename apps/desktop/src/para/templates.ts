import type { JSONContent } from '@tiptap/core'
import { createPage, withPage } from '../state/actions'
import { getState } from '../state/store'
import { ensureTemplatesFolder, loadTree, templateContent } from '../templates/apply'
import { paraRoleOf, refreshSpaces, type ParaRole, type Space } from './api'
import { coreClient } from '../lib/storage'

/**
 * The page templates of PARA: one per kind of item, kept in the Templates folder as ordinary
 * templates (edit them there, or use them with "New page from a template"). A new item made in
 * the app (captured, added to a PARA database, made from a relation cell) gets its kind's
 * template; a note promoted to a project gets the project template added below its text.
 */

const h = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const p = (text = ''): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const hint = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'italic' }] }] })
const tasks = (...items: string[]): JSONContent => ({
  type: 'taskList',
  content: (items.length ? items : ['']).map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(t)] })),
})
const bullets = (...items: string[]): JSONContent => ({
  type: 'bulletList',
  content: (items.length ? items : ['']).map((t) => ({ type: 'listItem', content: [p(t)] })),
})
const callout = (icon: string, text: string): JSONContent => ({ type: 'callout', attrs: { icon }, content: [{ type: 'text', text }] })

export const DEFAULTS: Record<ParaRole, { title: string; icon: string; content: JSONContent[] }> = {
  inbox: {
    title: 'PARA · Note',
    icon: '📝',
    content: [
      hint('Captured {{date:D MMMM YYYY}}. Write it down now, sort it later.'),
      p(),
      h('Why it matters'),
      p(),
      h('Next step'),
      tasks(),
    ],
  },
  projects: {
    title: 'PARA · Project',
    icon: '🚀',
    content: [
      callout('🎯', 'Outcome: what does done look like?'),
      h('Next actions'),
      tasks(),
      h('Milestones'),
      tasks(),
      h('Notes'),
      p(),
      h('Resources & links'),
      bullets(),
      h('Wrap-up'),
      hint('When it is done: what went well, what to do differently, what to keep as a resource. Then archive it as completed.'),
      p(),
    ],
  },
  areas: {
    title: 'PARA · Area',
    icon: '🧭',
    content: [
      callout('📏', 'Standard: what does keeping this up look like?'),
      h('Review checklist'),
      tasks('Is the health still right?', 'Are its projects moving? Any to start, pause or finish?', 'Anything to archive?', 'Mark reviewed'),
      h('Recurring'),
      tasks(),
      h('Notes'),
      p(),
    ],
  },
  resources: {
    title: 'PARA · Resource',
    icon: '📚',
    content: [
      h('Summary'),
      p(),
      h('Key points'),
      bullets(),
      h('Sources'),
      bullets(),
      h('Where I used it'),
      p(),
    ],
  },
}

const ROLES: ParaRole[] = ['inbox', 'projects', 'areas', 'resources']
let making: Promise<void> | null = null

/** Make the default templates of a space that has none yet (once; deleted ones stay deleted). */
export function ensureParaTemplates(space: Space): Promise<void> {
  if (space.templates && Object.keys(space.templates).length) return Promise.resolve()
  making ??= (async () => {
    const folder = await ensureTemplatesFolder()
    const made: Record<string, string> = {}
    for (const role of ROLES) {
      const d = DEFAULTS[role]
      const page = await createPage({ parentId: folder.id, title: d.title, icon: d.icon, open: false })
      await withPage(page.id, (s) => {
        s.setContent({ type: 'doc', content: d.content })
        return s.flush()
      })
      made[role] = page.id
    }
    await coreClient().call('paraSetTemplates', { id: space.hub, templates: made })
    await refreshSpaces()
  })().finally(() => (making = null))
  return making
}

/** The template page of a role, if it is still there. */
function templateOf(space: Space, role: ParaRole): string | null {
  const id = space.templates?.[role]
  const page = id ? getState().pages[id] : undefined
  return page && page.trashedAt == null ? page.id : null
}

const hasText = (ns: JSONContent[]): boolean =>
  ns.some((n) => n.type === 'text' ? !!n.text?.trim() : !['paragraph', 'heading'].includes(n.type ?? '') || hasText(n.content ?? []))

/**
 * Fill a new item with its role's template. `append` adds it below what is there (a promoted
 * note); otherwise a page that already has content is left alone.
 */
export async function applyParaTemplate(space: Space, role: ParaRole, rowId: string, append = false): Promise<void> {
  const id = templateOf(space, role)
  if (!id) return
  for (let i = 0; i < 30 && !getState().pages[rowId]; i++) await new Promise((r) => setTimeout(r, 100))
  const tree = await loadTree(id)
  const content = await templateContent(tree, {}, rowId)
  if (!content.length) return
  await withPage(rowId, (s) => {
    const existing = s.notesJSON(true).flatMap((n) => n.content ?? [])
    if (!append && hasText(existing)) return
    s.setContent({ type: 'doc', content: append && hasText(existing) ? [...existing, ...content] : content })
    return s.flush()
  })
}

/** A row was just made in a database: if it is a PARA database, give it its template. */
export async function newParaItem(databaseId: string, rowId: string): Promise<void> {
  const found = await paraRoleOf(databaseId).catch(() => null)
  if (found) await applyParaTemplate(found.space, found.role, rowId).catch(() => {})
}
