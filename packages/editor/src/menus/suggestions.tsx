import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { FilePlus2, Hash, Sparkles } from 'lucide-react'
import type { BlockOption, PageOption, SlashExtra } from '../host'
import { maybeHost } from '../host-extension'
import { filterSlash, runSlash, type SlashItem } from './items'
import { SuggestionList, type ListEntry, type SuggestionListHandle, type SuggestionListProps } from './SuggestionList'

/**
 * Wire a suggestion to the shared list UI. `toList` turns the suggestion state into what the
 * list shows and what happens on pick.
 */
function popup<I>(toList: (p: SuggestionProps<I, I>) => SuggestionListProps): SuggestionOptions<I, I>['render'] {
  return () => {
    let renderer: ReactRenderer<SuggestionListHandle, SuggestionListProps> | null = null
    let box: HTMLDivElement | null = null

    const place = (p: SuggestionProps<I, I>) => {
      const rect = p.clientRect?.()
      if (!box || !rect) return
      const h = box.offsetHeight
      const below = rect.bottom + 6
      box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8))}px`
      box.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : below}px`
    }

    return {
      onStart: (p) => {
        renderer = new ReactRenderer(SuggestionList, { props: toList(p), editor: p.editor })
        box = document.createElement('div')
        box.className = 'popover slash-menu suggestion-popover'
        box.style.position = 'fixed'
        box.addEventListener('mousedown', (e) => e.preventDefault())
        box.appendChild(renderer.element)
        ;(document.querySelector('.workspace') ?? document.body).appendChild(box)
        requestAnimationFrame(() => place(p))
      },
      onUpdate: (p) => {
        renderer?.updateProps(toList(p))
        requestAnimationFrame(() => place(p))
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === 'Escape') {
          box?.remove()
          return true
        }
        return renderer?.ref?.onKeyDown(event) ?? false
      },
      onExit: () => {
        box?.remove()
        renderer?.destroy()
        box = null
        renderer = null
      },
    }
  }
}

function suggestionExtension<I>(name: string, options: Omit<SuggestionOptions<I, I>, 'editor'>) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [Suggestion<I, I>({ editor: this.editor, pluginKey: new PluginKey(name), ...options })]
    },
  })
}

// ---------------------------------------------------------------- "/" commands

type SlashEntry = SlashItem | (SlashExtra & { extra: true })

export const SlashCommands = suggestionExtension<SlashEntry>('slashCommands', {
  char: '/',
  items: ({ query, editor }) => {
    const q = query.trim().toLowerCase()
    const extras = (maybeHost(editor)?.slashExtras ?? [])
      .filter((x) => !q || `${x.label} ${x.keywords ?? ''}`.toLowerCase().includes(q))
      .map((x) => ({ ...x, extra: true as const }))
    return [...filterSlash(query), ...extras]
  },
  command: ({ editor, range, props }) => {
    if ('extra' in props) {
      editor.chain().focus().deleteRange(range).run()
      return props.run(editor)
    }
    runSlash(editor, props.id, range)
  },
  allow: ({ state, range }) => {
    // Not inside code blocks.
    const $from = state.doc.resolve(range.from)
    return $from.parent.type.name !== 'codeBlock'
  },
  render: popup<SlashEntry>((p) => ({
    caption: p.query ? `Blocks matching “${p.query}”` : 'Basic blocks',
    empty: 'No matching blocks',
    entries: p.items.map((i) =>
      'extra' in i
        ? { key: i.id, label: i.label, desc: i.desc, icon: <Sparkles size={16} />, rich: true }
        : { key: i.id, label: i.label, desc: i.desc, hint: i.hint, icon: <i.icon size={16} />, rich: true },
    ),
    onPick: (i) => p.command(p.items[i]),
  })),
})

// ---------------------------------------------------------------- "[[" page links

type PageItem = { kind: 'page'; page: PageOption } | { kind: 'create'; title: string }

function linkPage(editor: Editor, range: Range, item: PageItem) {
  editor.chain().focus().deleteRange(range).run()
  if (item.kind === 'page') return editor.chain().focus().insertRef('page', item.page.id).run()
  const host = maybeHost(editor)
  void host?.createPage(item.title).then((id) => editor.chain().focus().insertRef('page', id).run())
}

export const PageLinkSuggestion = suggestionExtension<PageItem>('pageLinkSuggestion', {
  char: '[[',
  allowSpaces: true,
  allowedPrefixes: null,
  items: async ({ query, editor }) => {
    const host = maybeHost(editor)
    if (!host) return []
    const q = query.replace(/\]\]$/, '').trim()
    const pages = (await host.searchPages(q)).slice(0, 8).map((page): PageItem => ({ kind: 'page', page }))
    const exact = pages.some((p) => p.kind === 'page' && p.page.title.toLowerCase() === q.toLowerCase())
    return q && !exact ? [...pages, { kind: 'create', title: q }] : pages
  },
  command: ({ editor, range, props }) => linkPage(editor, range, props),
  render: popup<PageItem>((p) => ({
    caption: 'Link to page',
    empty: 'Type to search pages',
    entries: p.items.map(
      (it): ListEntry =>
        it.kind === 'page'
          ? { key: it.page.id, label: it.page.title || 'Untitled', icon: it.page.icon || '📄' }
          : { key: 'create', label: `Create “${it.title}”`, icon: <FilePlus2 size={14} /> },
    ),
    onPick: (i) => p.command(p.items[i]),
  })),
})

// ---------------------------------------------------------------- "((" block refs

export const BlockRefSuggestion = suggestionExtension<BlockOption>('blockRefSuggestion', {
  char: '((',
  allowSpaces: true,
  allowedPrefixes: null,
  items: async ({ query, editor }) => {
    const q = query.replace(/\)\)$/, '').trim()
    if (!q) return []
    return ((await maybeHost(editor)?.searchBlocks(q)) ?? []).slice(0, 8)
  },
  command: ({ editor, range, props }) => editor.chain().focus().deleteRange(range).insertRef('block', props.id).run(),
  render: popup<BlockOption>((p) => ({
    caption: 'Link to block',
    empty: p.query ? 'No matching blocks' : 'Type to search blocks',
    entries: p.items.map((b) => ({ key: b.id, label: b.text.slice(0, 80) || 'Empty block', icon: <Hash size={13} /> })),
    onPick: (i) => p.command(p.items[i]),
  })),
})
