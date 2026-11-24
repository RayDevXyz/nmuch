import type { JSONContent } from '@tiptap/core'
import { createRow } from '../database/api'
import { uid } from '../lib/id'
import { createPage, openPage, withPage } from '../state/actions'
import { getState, toast } from '../state/store'
import { addProp, readProps, updateProp } from '../properties/model'
import { applyDatabaseTemplate, createFromTemplate, loadTree, templateExists } from '../templates/apply'
import { collectVars, render, type Context, type Variable } from '../templates/engine'

/**
 * Buttons: a block that runs steps when clicked. Each step says *what* to do, *where*, and the
 * extras (a title with fields like {{date}}, a template, database values, tags, whether to open
 * the result). Fields that aren't filled in for you (`{{Topic}}`) are asked once per click.
 */

export type Where =
  | { kind: 'here' } // a sub-page of the page the button is on
  | { kind: 'top' } // a top-level page
  | { kind: 'page'; pageId: string } // under a chosen page
  | { kind: 'database'; databaseId: string } // a new row of a database

export type TextWhere =
  | { kind: 'below' } // right under the button
  | { kind: 'page'; pageId: string; position?: 'top' | 'bottom' }
  | { kind: 'created'; position?: 'top' | 'bottom' } // the page an earlier step made

export type TextStyle = 'paragraph' | 'todo' | 'bullet' | 'heading' | 'quote'

export type Step =
  | {
      kind: 'createPage'
      where: Where
      title: string
      /** A template id; for a database, '' means the database's own template and 'none' no template. */
      template?: string
      icon?: string
      /** For a page: tags (comma-separated, fields allowed). */
      tags?: string
      /** For a database row: column id → value (text values may use fields). */
      values?: Record<string, unknown>
      open?: 'tab' | 'replace' | 'none'
    }
  | { kind: 'addText'; where: TextWhere; text: string; style?: TextStyle }
  | { kind: 'open'; pageId?: string; url?: string }

export interface ButtonSettings {
  label: string
  icon: string
  /** '' (the theme's accent) or a hex colour. */
  color: string
  variant: 'solid' | 'soft' | 'outline' | 'ghost'
  width: 'auto' | 'full'
  /** Shown after it ran (fields allowed); empty: a short summary. */
  done?: string
  steps: Step[]
  /** Just inserted: open the settings. */
  edit?: boolean
}

export const DEFAULT: ButtonSettings = { label: 'Button', icon: '', color: '', variant: 'solid', width: 'auto', steps: [] }

export const settingsOf = (s: Record<string, unknown>): ButtonSettings => ({ ...DEFAULT, ...(s as Partial<ButtonSettings>), steps: Array.isArray(s.steps) ? (s.steps as Step[]) : [] })

/** Every text of the steps that can hold fields. */
function* texts(s: ButtonSettings): Generator<string> {
  if (s.done) yield s.done
  for (const st of s.steps) {
    if (st.kind === 'createPage') {
      yield st.title
      if (st.tags) yield st.tags
      for (const v of Object.values(st.values ?? {})) if (typeof v === 'string') yield v
    } else if (st.kind === 'addText') yield st.text
  }
}

/** The fields a click asks for (the built-in ones, like {{date}}, are filled in). */
export function askedVars(s: ButtonSettings): Variable[] {
  return collectVars(texts(s))
}

const waitFor = async (id: string) => {
  for (let i = 0; i < 40 && !getState().pages[id]; i++) await new Promise((r) => setTimeout(r, 100))
}

function textBlock(text: string, style: TextStyle = 'paragraph'): JSONContent {
  const inline = text ? [{ type: 'text', text }] : undefined
  const p = { type: 'paragraph', ...(inline ? { content: inline } : {}) }
  switch (style) {
    case 'todo':
      return { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p] }] }
    case 'bullet':
      return { type: 'bulletList', content: [{ type: 'listItem', content: [p] }] }
    case 'heading':
      return { type: 'heading', attrs: { level: 2 }, ...(inline ? { content: inline } : {}) }
    case 'quote':
      return { type: 'blockquote', content: [p] }
    default:
      return p
  }
}

async function addToPage(pageId: string, block: JSONContent, position: 'top' | 'bottom' = 'bottom') {
  await waitFor(pageId)
  await withPage(pageId, (s) => {
    const existing = s.notesJSON(true).flatMap((n) => n.content ?? [])
    // A page that is just one empty line: replace it.
    const blank = existing.length <= 1 && !existing.some((n) => n.content?.length)
    const content = blank ? [block] : position === 'top' ? [block, ...existing] : [...existing, block]
    s.setContent({ type: 'doc', content })
    return s.flush()
  })
}

function renderValues(values: Record<string, unknown> | undefined, ctx: Context): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values ?? {})) {
    if (v === '' || v == null) continue
    out[k] = typeof v === 'string' ? render(v, ctx) : v
  }
  return out
}

async function setTags(pageId: string, tags: string[]) {
  if (!tags.length) return
  await waitFor(pageId)
  await withPage(pageId, (s) => {
    const { props } = readProps(s.doc)
    const existing = props.find((p) => p.name.toLowerCase() === 'tags')
    const id = existing?.id ?? addProp(s.doc, 'Tags', 'multiSelect')
    const before = Array.isArray(existing?.value) ? (existing!.value as string[]) : []
    updateProp(s.doc, id, { value: [...new Set([...before, ...tags])] })
    return s.flush()
  })
}

export interface RunContext {
  /** The page the button is on. */
  pageId: string
  insertBelow(content: JSONContent[]): void
}

/** Run the steps. `values`: the answers to the asked fields (lower-case names). */
export async function runButton(s: ButtonSettings, run: RunContext, values: Record<string, string> = {}): Promise<string> {
  const here = getState().pages[run.pageId]
  const ctx: Context = { values, title: here?.title ?? '', parent: here?.title ?? '', template: '', now: new Date() }
  let created: string | null = null
  const did: string[] = []
  for (const st of s.steps) {
    if (st.kind === 'createPage') {
      const title = render(st.title ?? '', ctx).trim()
      const w = st.where ?? { kind: 'here' }
      let id: string
      if (w.kind === 'database') {
        id = uid()
        await createRow(w.databaseId, id, title, renderValues(st.values, ctx))
        // '' : the database's own template; 'none': none; else that template.
        if (st.template !== 'none') await applyDatabaseTemplate(w.databaseId, id, st.template ? st.template : undefined)
      } else {
        const parentId = w.kind === 'here' ? run.pageId : w.kind === 'page' ? w.pageId : null
        if (st.template && templateExists(st.template)) {
          id = await createFromTemplate(await loadTree(st.template), { title, values, parentId, open: false })
        } else {
          id = (await createPage({ parentId, title, icon: st.icon || undefined, open: false })).id
        }
        const tags = render(st.tags ?? '', ctx)
          .split(',')
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean)
        await setTags(id, tags)
      }
      created = id
      did.push(`made “${title || 'Untitled'}”`)
      if (st.open && st.open !== 'none') {
        await waitFor(id)
        openPage(id, st.open)
      }
    } else if (st.kind === 'addText') {
      const block = textBlock(render(st.text ?? '', ctx), st.style)
      const w = st.where ?? { kind: 'below' }
      if (w.kind === 'below') run.insertBelow([block])
      else if (w.kind === 'page' && w.pageId) await addToPage(w.pageId, block, w.position)
      else if (w.kind === 'created') {
        if (!created) throw new Error('“In the page just made” needs a step that makes a page before it.')
        await addToPage(created, block, w.position)
      }
      did.push('added text')
    } else if (st.kind === 'open') {
      if (st.pageId && getState().pages[st.pageId]) openPage(st.pageId, 'tab')
      else if (st.url) window.open(st.url, '_blank', 'noopener')
      did.push('opened')
    }
  }
  return s.done ? render(s.done, ctx) : did.length ? did.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Nothing to do yet: add a step'
}

export const notify = (msg: string) => toast(msg)
