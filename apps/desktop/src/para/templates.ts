import type { JSONContent } from '@tiptap/core'
import { createPage, withPage } from '../state/actions'
import { ensureTemplatesFolder, templateExists } from '../templates/apply'
import { databaseTemplate, setDatabaseTemplate } from '../database/api'
import { refreshSpaces, type ParaRole, type Space } from './api'
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
    for (const role of ROLES) await setDatabaseTemplate(space[role], made[role])
    await refreshSpaces()
  })().finally(() => (making = null))
  return making
}

/**
 * Each PARA database uses its kind's template for new pages (the database's own "Template for new
 * pages" setting). Set it where it isn't yet: right after the templates are made, and once for
 * spaces made before databases had that setting. A database whose template was changed or cleared
 * keeps that choice, because only a role whose template page still exists is set, and only once.
 */
export async function linkParaTemplates(space: Space): Promise<void> {
  const done = `bw.paraLinked.${space.hub}`
  try {
    if (localStorage.getItem(done)) return
  } catch {
    /* no storage: check every time, harmless */
  }
  for (const role of ROLES) {
    const id = space.templates?.[role]
    if (!id || !templateExists(id)) continue
    const current = await databaseTemplate(space[role]).catch(() => null)
    if (!current) await setDatabaseTemplate(space[role], id)
  }
  try {
    localStorage.setItem(done, '1')
  } catch {
    /* not remembered */
  }
}
