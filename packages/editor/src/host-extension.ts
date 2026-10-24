import { Extension, type Editor } from '@tiptap/core'
import type { EditorHost } from './host'

/** Makes the host reachable from node views and menus through `editor.storage`. */
export const HostExtension = Extension.create<{ host: EditorHost | null }, { host: EditorHost | null }>({
  name: 'bwHost',
  addOptions() {
    return { host: null }
  },
  addStorage() {
    return { host: this.options.host }
  },
})

export function hostOf(editor: Editor): EditorHost {
  const host = (editor.storage as unknown as Record<string, { host: EditorHost | null }>).bwHost?.host
  if (!host) throw new Error('editor has no host')
  return host
}

export function maybeHost(editor: Editor): EditorHost | null {
  return (editor.storage as unknown as Record<string, { host: EditorHost | null }>).bwHost?.host ?? null
}
