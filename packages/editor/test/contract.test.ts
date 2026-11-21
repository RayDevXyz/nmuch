/**
 * Contract between the Tiptap editor and the Rust core. Both read and write the same Y.Doc
 * layout, so each side checks the other's output:
 *
 * - editor -> core: build a page with Tiptap's own Yjs binding (y-tiptap) and write it as a
 *   fixture plus what the editor says its blocks are. `crates/bw-core/tests/contract.rs`
 *   reads it with the Rust snapshot code and compares.
 * - core -> editor: `cargo run -p bw-core --example contract_fixture` writes a page built
 *   with the Rust block builders. Here Tiptap must load every node *unchanged* (y-tiptap
 *   silently deletes nodes that don't fit the schema, so "unchanged" is the real test).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSchema, type JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { BLOCK_TYPES, schemaExtensions } from '../src'

const FIXTURES = join(__dirname, '../../../crates/bw-core/tests/fixtures')
const schema = getSchema(schemaExtensions())

const t = (text: string, marks?: string[]): JSONContent => ({ type: 'text', text, ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}) })
const p = (id: string, ...content: JSONContent[]): JSONContent => ({ type: 'paragraph', attrs: { id }, content })

/** Every node type the editor can produce. */
const DOC: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [t('Title '), t('bold', ['bold'])] },
    p('p1', t('See '), { type: 'ref', attrs: { kind: 'page', target: 'page-2' } }, t(' and '), { type: 'ref', attrs: { kind: 'block', target: 'h1' } }, { type: 'hardBreak' }, t('line two #tag')),
    { type: 'callout', attrs: { id: 'c1', icon: '✨' }, content: [t('Callout text', ['italic'])] },
    { type: 'blockquote', attrs: { id: 'q1' }, content: [p('q1p', t('Quoted'))] },
    {
      type: 'bulletList',
      attrs: { id: 'ul1' },
      content: [
        { type: 'listItem', attrs: { id: 'li1' }, content: [p('li1p', t('One')), { type: 'bulletList', attrs: { id: 'ul2' }, content: [{ type: 'listItem', attrs: { id: 'li2' }, content: [p('li2p', t('Nested'))] }] }] },
      ],
    },
    { type: 'orderedList', attrs: { id: 'ol1', start: 3 }, content: [{ type: 'listItem', attrs: { id: 'li3' }, content: [p('li3p', t('Third'))] }] },
    { type: 'taskList', attrs: { id: 'tl1' }, content: [{ type: 'taskItem', attrs: { id: 'ti1', checked: true }, content: [p('ti1p', t('Done'))] }] },
    { type: 'codeBlock', attrs: { id: 'cb1', language: 'ts' }, content: [t('const x = 1\nconst y = 2')] },
    { type: 'horizontalRule', attrs: { id: 'hr1' } },
    { type: 'image', attrs: { id: 'img1', src: 'https://example.com/a.png', caption: 'A picture' } },
    { type: 'pageLink', attrs: { id: 'pl1', pageId: 'page-3' } },
    { type: 'database', attrs: { id: 'db1', databaseId: 'db-courses', viewId: 'v-table' } },
    {
      type: 'widget',
      attrs: { id: 'w1', widget: 'progress', bindings: JSON.stringify({ items: { databaseId: 'db-lessons', fields: { done: 'done' } } }), settings: '{"label":"Done"}' },
    },
    { type: 'moc', attrs: { id: 'moc1', settings: '{"source":"children"}' } },
    {
      type: 'table',
      attrs: { id: 'tb1' },
      content: [
        { type: 'tableRow', attrs: { id: 'tr1' }, content: [{ type: 'tableHeader', attrs: { id: 'th1', colspan: 1, rowspan: 1, colwidth: null }, content: [p('th1p', t('Name'))] }] },
        { type: 'tableRow', attrs: { id: 'tr2' }, content: [{ type: 'tableCell', attrs: { id: 'td1', colspan: 1, rowspan: 1, colwidth: null }, content: [p('td1p', t('Ada', ['bold']))] }] },
      ],
    },
    p('p2', t('link', ['link'])),
  ],
}

/** What the core should see for each block, derived from ProseMirror alone. */
function expectedBlocks(doc: JSONContent) {
  const out: unknown[] = []
  const walk = (n: JSONContent, depth: number) => {
    if (!(BLOCK_TYPES as readonly string[]).includes(n.type ?? '')) return
    const node = schema.nodeFromJSON(n)
    let text = ''
    const refs: [string, string][] = []
    node.forEach((c) => {
      if (c.isText) text += c.text
      else if (c.type.name === 'hardBreak') text += '\n'
      else if (c.type.name === 'ref') {
        text += '￼'
        refs.push([c.attrs.target, c.attrs.kind])
      }
    })
    if (n.type === 'image') text = node.attrs.caption
    if (n.type === 'widget') {
      const b = JSON.parse(node.attrs.bindings) as Record<string, { databaseId: string }>
      Object.values(b).forEach((x) => refs.push([x.databaseId, 'page']))
    }
    if (n.type === 'database') {
      text = '\uFFFC'
      refs.push([node.attrs.databaseId, 'page'])
    }
    if (n.type === 'pageLink') {
      text = '\uFFFC'
      refs.push([node.attrs.pageId, 'page'])
    }
    const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([k, v]) => k !== 'id' && v !== null))
    out.push({ id: node.attrs.id, type: n.type, depth, text, attrs, refs })
    n.content?.forEach((c) => walk(c, depth + 1))
  }
  doc.content?.forEach((c) => walk(c, 2))
  return out
}

describe('editor -> core', () => {
  it('the fixture document is valid for the editor schema', () => {
    expect(() => schema.nodeFromJSON(DOC).check()).not.toThrow()
  })

  it('round-trips through Yjs unchanged and matches the committed fixture', () => {
    const doc = new Y.Doc()
    const page = doc.getMap('page')
    page.set('id', 'editor-page')
    page.set('schema', 2)
    page.set('title', 'Made in the editor')
    const note = new Y.Map()
    doc.getMap('notes').set('note-1', note)
    note.set('id', 'note-1')
    note.set('order', 'a0')
    note.set('xywh', null)
    const fragment = new Y.XmlFragment()
    note.set('content', fragment)
    prosemirrorJSONToYXmlFragment(schema, DOC, fragment)

    expect(yXmlFragmentToProseMirrorRootNode(fragment, schema).toJSON()).toEqual(schema.nodeFromJSON(DOC).toJSON())

    const expected = { pageId: 'editor-page', title: 'Made in the editor', blocks: expectedBlocks(DOC) }
    const expectedPath = join(FIXTURES, 'editor-page.expected.json')
    if (process.env.UPDATE_FIXTURES) {
      writeFileSync(join(FIXTURES, 'editor-page.bin'), Y.encodeStateAsUpdate(doc))
      writeFileSync(expectedPath, JSON.stringify(expected, null, 2) + '\n')
    }
    expect(JSON.parse(readFileSync(expectedPath, 'utf8'))).toEqual(expected)
  })
})

describe('core -> editor', () => {
  it('Tiptap loads every block the core builds, without changing it', () => {
    const expected = JSON.parse(readFileSync(join(FIXTURES, 'core-page.expected.json'), 'utf8'))
    const doc = new Y.Doc()
    Y.applyUpdate(doc, readFileSync(join(FIXTURES, 'core-page.bin')))
    expect(doc.getMap('page').get('title')).toBe('Made in Rust')

    const notes = [...(doc.getMap('notes') as Y.Map<Y.Map<unknown>>).values()].sort((a, b) =>
      String(a.get('order')).localeCompare(String(b.get('order'))),
    )
    expect(notes).toHaveLength(2)

    const seen: { id: string; type: string }[] = []
    for (const note of notes) {
      const fragment = note.get('content') as Y.XmlFragment
      const before = fragment.toString()
      const pm = yXmlFragmentToProseMirrorRootNode(fragment, schema)
      expect(() => pm.check()).not.toThrow()
      expect(fragment.toString()).toBe(before) // nothing was dropped as invalid
      pm.descendants((node) => {
        if ((BLOCK_TYPES as readonly string[]).includes(node.type.name)) seen.push({ id: node.attrs.id, type: node.type.name })
      })
    }
    expect(seen.map((b) => [b.id, b.type])).toEqual(expected.blocks.map((b: { id: string; type: string }) => [b.id, b.type]))
  })
})
