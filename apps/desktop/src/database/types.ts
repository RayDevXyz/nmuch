/** Mirrors of the Rust database types (`crates/bw-core/src/database.rs`, `db_query.rs`). */

export type PropType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'file'
  | 'relation'
  | 'rollup'

export type RollupFn = 'count' | 'countValues' | 'percentChecked' | 'sum' | 'average' | 'min' | 'max' | 'showValues'
export type FilterOp = 'is' | 'isNot' | 'contains' | 'notContains' | 'gt' | 'lt' | 'empty' | 'notEmpty'
export type ViewKind = 'table' | 'board' | 'gallery'

export interface SelectOption {
  id: string
  name: string
  color: string
}

export interface Property {
  id: string
  name: string
  type: PropType
  order: string
  options?: SelectOption[]
  relation?: { databaseId: string; syncedProperty?: string; computed?: boolean }
  rollup?: { relation: string; property: string; function: RollupFn }
}

export interface Filter {
  property: string
  op: FilterOp
  value?: unknown
}

export interface Sort {
  property: string
  desc?: boolean
}

export interface View {
  id: string
  name: string
  type: ViewKind
  order: string
  filters: Filter[]
  sorts: Sort[]
  groupBy?: string
  /** Columns this view hides; everything else shows (so new columns appear everywhere). */
  hidden?: string[]
}

export interface RowRef {
  id: string
  title: string
  icon: string
}

export interface Row extends RowRef {
  createdAt: number
  updatedAt: number
  values: Record<string, unknown>
}

export interface Group {
  id: string | null
  name: string
  color: string
  rows: string[]
}

export interface DatabaseResult {
  databaseId: string
  title: string
  icon: string
  properties: Property[]
  views: View[]
  view: View
  rows: Row[]
  groups: Group[]
  related: Record<string, RowRef>
  total: number
  /** The template new rows start from (a page id), if set. */
  template?: string
}

export const TITLE = 'title'

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const

export const TYPE_LABEL: Record<PropType, string> = {
  title: 'Title',
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multiSelect: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
  file: 'File path',
  relation: 'Relation',
  rollup: 'Rollup',
}

export const ROLLUP_LABEL: Record<RollupFn, string> = {
  count: 'Count all',
  countValues: 'Count values',
  percentChecked: 'Percent checked',
  sum: 'Sum',
  average: 'Average',
  min: 'Min',
  max: 'Max',
  showValues: 'Show values',
}

export const FILTER_LABEL: Record<FilterOp, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  gt: 'greater than',
  lt: 'less than',
  empty: 'is empty',
  notEmpty: 'is not empty',
}
