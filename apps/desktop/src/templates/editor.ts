import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core'
import type { SlashExtra } from '@brainwaves/editor'
import { getState, toast } from '../state/store'
import { createFromTemplate, findTemplate, listTemplates, loadTree, variablesOf } from './apply'
import { parseTemplateCall } from './engine'
import { filledIn, openTemplateDialog } from './TemplateDialog'

const link = (pageId: string): JSONContent[] => [{ type: 'pageLink', attrs: { pageId } }]

/** What the form's result puts in the page: a link to the new page, or the template's content. */
const insert = (editor: TiptapEditor) => (r: { pageId: string } | { content: JSONContent[] }) =>
  void editor.chain().focus().insertContent('pageId' in r ? link(r.pageId) : r.content).run()

/** `/template`, and one `/` entry per template. */
export function templateSlashExtras(pageId: string): SlashExtra[] {
  return [
    {
      id: 'template',
      label: 'Template…',
      desc: 'A new sub-page from a template, or its content here',
      keywords: 'template new page form variables',
      group: 'Templates',
      run: (editor) => openTemplateDialog({ parentId: pageId, fromEditor: true, onDone: insert(editor) }),
    },
    ...listTemplates().map((t) => ({
      id: `template:${t.id}`,
      label: `${t.icon ? t.icon + ' ' : ''}${t.title.replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim() || t.title || 'Untitled'}`,
      desc: t.title.includes('{{') ? `Template · ${t.title}` : 'Template',
      keywords: `template ${t.title}`,
      group: 'Templates',
      run: (editor: TiptapEditor) => openTemplateDialog({ parentId: pageId, templateId: t.id, fromEditor: true, onDone: insert(editor) }),
    })),
  ]
}

/**
 * `{{template: Name | title: … | Field: value}}` + Enter in a page: a sub-page from that template,
 * linked in place of the line. When every field has a value (given or a default) it's made at
 * once; otherwise the form opens with what was given.
 */
export function templateCall(text: string, pageId: string): Promise<JSONContent[] | null> | null {
  const call = parseTemplateCall(text)
  if (!call) return null
  return (async () => {
    const t = findTemplate(call.name)
    if (!t) {
      toast(`No template called "${call.name}" (templates are the pages inside Templates)`)
      return null
    }
    const tree = await loadTree(t.id)
    if (filledIn(variablesOf(tree), call.values)) {
      const id = await createFromTemplate(tree, { title: call.values.title ?? '', values: call.values, parentId: pageId, open: false })
      toast(`Made "${getState().pages[id]?.title || 'the page'}" from ${t.title}`)
      return link(id)
    }
    return new Promise<JSONContent[] | null>((resolve) =>
      openTemplateDialog({
        parentId: pageId,
        templateId: t.id,
        values: call.values,
        onDone: (r) => resolve('pageId' in r ? link(r.pageId) : r.content),
        onCancel: () => resolve(null),
      }),
    )
  })()
}
