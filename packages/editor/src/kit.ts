import type { Extensions } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import type * as Y from 'yjs'
import { BlockId } from './block-id'
import type { EditorHost } from './host'
import { HostExtension } from './host-extension'
import { Callout } from './nodes/callout'
import { Database } from './nodes/database'
import { Widget } from './nodes/widget'
import { Image } from './nodes/image'
import { PageLink } from './nodes/page-link'
import { Ref } from './nodes/ref'
import { MarkdownPaste } from './nodes/markdown-paste'
import { Tags } from './nodes/tags'
import { BlockRefSuggestion, PageLinkSuggestion, SlashCommands } from './menus/suggestions'

export interface KitOptions {
  /** The note this editor edits. Omit for a headless schema (tests, conversions). */
  fragment?: Y.XmlFragment
  host?: EditorHost
}

/**
 * The extensions that define the page schema. Headless code (tests, seeding, Markdown
 * conversion) and the live editor use the same list, so they always agree on the schema.
 */
export function schemaExtensions(): Extensions {
  return [
    StarterKit.configure({
      // Undo/redo comes from Yjs (per note) through the Collaboration extension.
      undoRedo: false,
      link: { openOnClick: false, autolink: true },
      trailingNode: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    Image,
    PageLink,
    Database,
    Widget,
    Ref,
    BlockId,
  ]
}

export function editorExtensions({ fragment, host }: KitOptions): Extensions {
  return [
    ...schemaExtensions(),
    HostExtension.configure({ host: host ?? null }),
    Tags,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
        if (node.type.name === 'paragraph') return "Type '/' for commands"
        return ''
      },
    }),
    ...(host ? [SlashCommands, PageLinkSuggestion, BlockRefSuggestion, MarkdownPaste] : []),
    ...(fragment ? [Collaboration.configure({ fragment })] : []),
  ]
}
