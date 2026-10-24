import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Check, Copy, FileText, GripVertical, Plus } from 'lucide-react'
import type { Block, BlockProps } from '../lib/types'
import { isTextual } from '../lib/blocks'
import { useApp } from '../state/store'
import { PLACEHOLDER } from './blockTypes'

export interface BlockApi {
  onInput(block: Block, el: HTMLElement, data: string | null, inputType: string): void
  onKeyDown(e: KeyboardEvent<HTMLElement>, block: Block, el: HTMLElement): void
  onCodeKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, block: Block, el: HTMLTextAreaElement): void
  onCodeInput(block: Block, value: string): void
  onPaste(e: React.ClipboardEvent<HTMLElement>, block: Block, el: HTMLElement): void
  onFocus(block: Block): void
  onClickContent(e: React.MouseEvent<HTMLElement>, block: Block): void
  setProps(block: Block, props: Partial<BlockProps>, checkpoint?: boolean): void
  onHandleDown(e: PointerEvent<HTMLElement>, block: Block): void
  addBelow(block: Block): void
  openIconPicker(block: Block, anchor: HTMLElement): void
  openPage(pageId: string, newTab: boolean): void
  selectBlock(block: Block): void
  spellcheck: boolean
}

interface Props {
  block: Block
  number: number
  selected: boolean
  drop: 'before' | 'after' | null
  api: BlockApi
}

function Editable({ block, api, className }: { block: Block; api: BlockApi; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== block.text) el.innerHTML = block.text
  }, [block.text])
  return (
    <div
      ref={ref}
      className={`ce ${className ?? ''}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={api.spellcheck}
      data-ce={block.id}
      data-placeholder={PLACEHOLDER[block.type] ?? ''}
      onInput={(e) => {
        const ne = e.nativeEvent as InputEvent
        api.onInput(block, e.currentTarget, ne.data ?? null, ne.inputType ?? '')
      }}
      onKeyDown={(e) => api.onKeyDown(e, block, e.currentTarget)}
      onPaste={(e) => api.onPaste(e, block, e.currentTarget)}
      onFocus={() => api.onFocus(block)}
      onClick={(e) => api.onClickContent(e, block)}
    />
  )
}

function CodeBlock({ block, api }: { block: Block; api: BlockApi }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.value !== block.text) el.value = block.text
    fit()
  }, [block.text])
  return (
    <div className="code-block">
      <div className="code-head">
        <input
          className="code-lang"
          placeholder="language"
          defaultValue={block.props.lang ?? ''}
          spellCheck={false}
          onChange={(e) => api.setProps(block, { lang: e.target.value })}
        />
        <button
          className="code-copy"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            navigator.clipboard?.writeText(block.text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea
        ref={ref}
        className="code-input"
        data-ce={block.id}
        spellCheck={false}
        rows={1}
        defaultValue={block.text}
        onInput={(e) => {
          fit()
          api.onCodeInput(block, e.currentTarget.value)
        }}
        onKeyDown={(e) => api.onCodeKeyDown(e, block, e.currentTarget)}
        onFocus={() => api.onFocus(block)}
      />
    </div>
  )
}

function PageBlock({ block, api }: { block: Block; api: BlockApi }) {
  const page = useApp((s) => (block.props.pageId ? s.pages[block.props.pageId] : undefined))
  const gone = !page || page.trashedAt != null
  return (
    <div
      className={`page-block focusable ${gone ? 'missing' : ''}`}
      tabIndex={0}
      data-ce={block.id}
      onKeyDown={(e) => api.onKeyDown(e, block, e.currentTarget)}
      onFocus={() => api.onFocus(block)}
      onClick={(e) => page && !gone && api.openPage(page.id, e.ctrlKey || e.metaKey)}
    >
      <span className="page-block-icon">{page?.icon || <FileText size={16} />}</span>
      <span className="page-block-title">{gone ? 'Deleted page' : page.title || 'Untitled'}</span>
    </div>
  )
}

function Content({ block, number, api }: { block: Block; number: number; api: BlockApi }) {
  const t = block.type
  if (t === 'code') return <CodeBlock block={block} api={api} />
  if (t === 'page') return <PageBlock block={block} api={api} />
  if (t === 'divider')
    return (
      <div className="divider-block focusable" tabIndex={0} data-ce={block.id} onKeyDown={(e) => api.onKeyDown(e, block, e.currentTarget)} onFocus={() => api.onFocus(block)}>
        <div className="divider-line" />
      </div>
    )
  if (t === 'image')
    return (
      <figure className="image-block focusable" tabIndex={0} data-ce={block.id} onKeyDown={(e) => api.onKeyDown(e, block, e.currentTarget)} onFocus={() => api.onFocus(block)}>
        {block.props.src ? <img src={block.props.src} alt={block.props.caption ?? ''} draggable={false} /> : <div className="image-empty">No image</div>}
        <input
          className="image-caption"
          placeholder="Add a caption…"
          defaultValue={block.props.caption ?? ''}
          onChange={(e) => api.setProps(block, { caption: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </figure>
    )

  // textual blocks share one structure so the contentEditable survives type changes
  const indent = block.props.indent ?? 0
  let marker: React.ReactNode = false
  if (t === 'bullet') marker = <span className="marker bullet-marker">{['•', '◦', '▪'][indent % 3]}</span>
  else if (t === 'numbered') marker = <span className="marker number-marker">{number}.</span>
  else if (t === 'todo')
    marker = (
      <button
        className={`marker todo-box ${block.props.checked ? 'checked' : ''}`}
        aria-label={block.props.checked ? 'Mark as not done' : 'Mark as done'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => api.setProps(block, { checked: !block.props.checked }, true)}
      >
        {block.props.checked && <Check size={11} strokeWidth={3} />}
      </button>
    )
  else if (t === 'callout')
    marker = (
      <button className="marker callout-icon" onMouseDown={(e) => e.preventDefault()} onClick={(e) => api.openIconPicker(block, e.currentTarget)}>
        {block.props.icon || '💡'}
      </button>
    )
  return (
    <div className={`text-block t-${t} ${t === 'todo' && block.props.checked ? 'done' : ''}`}>
      {marker}
      <Editable block={block} api={api} />
    </div>
  )
}

function BlockViewInner({ block, number, selected, drop, api }: Props) {
  const indent = block.props.indent ?? 0
  return (
    <div
      className={`block-row b-${block.type} ${selected ? 'selected' : ''} ${drop ? 'drop-' + drop : ''}`}
      data-block-row={block.id}
      style={{ paddingLeft: indent * 26 }}
    >
      <div className="block-gutter" contentEditable={false}>
        <button className="gutter-btn" aria-label="Add block below" onMouseDown={(e) => e.preventDefault()} onClick={() => api.addBelow(block)}>
          <Plus size={15} />
        </button>
        <button className="gutter-btn handle" aria-label="Drag to move, click for options" onPointerDown={(e) => api.onHandleDown(e, block)}>
          <GripVertical size={15} />
        </button>
      </div>
      <div className="block-body">
        <Content block={block} number={number} api={api} />
      </div>
    </div>
  )
}

export const BlockView = memo(BlockViewInner, (a, b) => a.block === b.block && a.number === b.number && a.selected === b.selected && a.drop === b.drop && a.api === b.api)

export const isTextBlock = (b: Block) => isTextual(b.type)
