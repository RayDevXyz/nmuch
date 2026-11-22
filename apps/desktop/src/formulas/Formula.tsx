import type { FormulaInlineProps } from '@brainwaves/editor'
import { Sigma, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Popover } from '../components/Popover'
import { sourceFor, useFormulaVersion } from './data'
import { evaluate, show, type Value } from './lang'

type Result = { value: Value } | { error: string } | null

/** Evaluate `expr` on `pageId`, again whenever its inputs may have changed. */
function useResult(expr: string, pageId: string, delay = 0): Result {
  const v = useFormulaVersion()
  const [r, setR] = useState<Result>(null)
  useEffect(() => {
    if (!expr.trim()) return setR(null)
    let live = true
    const t = setTimeout(() => void evaluate(expr, sourceFor(pageId)).then((x) => live && setR(x)), delay)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [expr, pageId, v, delay])
  return r
}

const EXAMPLES: [string, string][] = [
  ['Status', "this page's property"],
  ['prop("Due date")', 'a name with spaces'],
  ['[[Dune]].Rating', "another page's property or cell"],
  ['[[Books]].count(Read = true)', 'rows of a database'],
  ['[[Books]].sum(Pages)', 'also avg, min, max'],
  ['[[Books]].where(Genre = "Sci-fi").list(title)', 'filter, then list'],
  ['if(Pages > 300, "long", "short")', 'logic'],
  ['days(today(), prop("Due date"))', 'dates'],
]

export function FormulaInline({ expr, editable, onChange, onDelete, pageId }: FormulaInlineProps & { pageId: string }) {
  const result = useResult(expr, pageId)
  const [at, setAt] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLButtonElement>(null)
  // A new, empty formula opens its editor.
  useEffect(() => {
    if (editable && !expr && ref.current) setAt(ref.current.getBoundingClientRect())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const err = result && 'error' in result ? result.error : null
  return (
    <>
      <button
        ref={ref}
        className={`formula ${err ? 'error' : ''} ${!expr ? 'empty' : ''}`}
        title={err ? `${err}\n${expr}` : expr || 'Empty formula'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => editable && setAt(e.currentTarget.getBoundingClientRect())}
      >
        {!expr ? (
          <>
            <Sigma size={11} /> formula
          </>
        ) : err ? (
          '⚠'
        ) : result && 'value' in result ? (
          show(result.value)
        ) : (
          '…'
        )}
      </button>
      {at && <Editor expr={expr} pageId={pageId} at={at} onChange={onChange} onDelete={onDelete} close={() => setAt(null)} />}
    </>
  )
}

function Editor({ expr, pageId, at, onChange, onDelete, close }: { expr: string; pageId: string; at: DOMRect; onChange: (e: string) => void; onDelete: () => void; close: () => void }) {
  const [text, setText] = useState(expr)
  const preview = useResult(text, pageId, 250)
  const done = () => {
    const t = text.trim()
    if (!t) onDelete()
    else if (t !== expr) onChange(t)
    close()
  }
  return (
    <Popover x={at.left} y={at.bottom} anchorTop={at.top} onClose={done} className="formula-pop">
      <div className="fx-head">
        <Sigma size={14} /> Formula
      </div>
      <textarea
        autoFocus
        className="fx-input"
        spellCheck={false}
        rows={2}
        placeholder='e.g. [[Books]].count(Read = true)'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            done()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <div className={`fx-preview ${preview && 'error' in preview ? 'error' : ''}`}>
        {!text.trim() ? 'Type a formula: a property, a database total, some logic.' : !preview ? '…' : 'error' in preview ? `⚠ ${preview.error}` : <>= <b>{show(preview.value)}</b></>}
      </div>
      <div className="fx-examples">
        {EXAMPLES.map(([e, what]) => (
          <button key={e} onClick={() => setText(e)} title="Use this">
            <code>{e}</code>
            <span>{what}</span>
          </button>
        ))}
      </div>
      <div className="fx-actions">
        <button className="fx-del" onClick={() => (onDelete(), close())}>
          <Trash2 size={13} /> Remove
        </button>
        <button className="fx-done" onClick={done}>
          Done
        </button>
      </div>
    </Popover>
  )
}
