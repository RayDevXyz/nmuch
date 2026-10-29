/**
 * The node names of the BrainWaves page schema. This is the contract with the Rust core:
 * `crates/bw-core/src/schema.rs` (module `node`) must list the same names.
 *
 * Every block node carries a stable `id` attribute (see `block-id.ts`). Inline nodes don't.
 */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'callout',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'image',
  'pageLink',
  'database',
  'widget',
] as const

export type BlockTypeName = (typeof BLOCK_TYPES)[number]

export const INLINE_TYPES = ['ref', 'hardBreak'] as const

export type RefKind = 'page' | 'block'
