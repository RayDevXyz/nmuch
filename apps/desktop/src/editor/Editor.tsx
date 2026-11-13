import { NoteEditor, outlineOf, statsOf, toMarkdown, type EditorHost, type RefKind, type SlashExtra } from '@brainwaves/editor'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { Smile } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { EmojiPicker } from '../components/EmojiPicker'
import { blockInfo, useBlockInfo } from '../lib/block-cache'
import { caretOnLastLine } from '../lib/caret'
import { markdownToContent } from '../lib/convert'
import type { NoteRef, PageSync } from '../lib/core/page-sync'
import { db, openExternal } from '../lib/storage'
import { relativeTime } from '../lib/time'
import type { Page } from '../lib/types'
import { createPage, openPage, releasePage, syncPage, titleOf, updatePage, withPage } from '../state/actions'
import { getState, setState, toast, useApp } from '../state/store'
import { databaseDef } from '../database/api'
import { DatabaseView, RowProperties } from '../database/DatabaseView'
import { createCourseTracker } from '../database/templates'
import { installedWidgets } from '../widgets/api'
import { installedModules } from '../modules/api'
import { WidgetBlock } from '../widgets/WidgetBlock'
import { Canvas } from '../edgeless/Canvas'
import { dndSlashExtras } from '../dnd/slash'
import { charactersDb, isThemed, useRoles } from '../dnd/api'
import { CharacterSheet } from '../dnd/CharacterSheet'
import { CampaignOverview } from '../dnd/Campaign'

export async function pageMarkdown(pageId: string): Promise<string> {
  const page = getState().pages[pageId]
  const titles = async (notes: ReturnType<PageSync['notesJSON']>) => {
    // Block refs need their text from the index; page refs come from the store.
    const ids = new Set<string>()
    const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (n.type === 'ref' && n.attrs?.kind === 'block') ids.add(String(n.attrs.target))
      ;(n.content as (typeof n)[] | undefined)?.forEach(walk)
    }
    notes.forEach(walk)
    const infos = ids.size ? await db().blockInfos([...ids]) : []
    return new Map(infos.map((b) => [b.id, b.text]))
  }
  return withPage(pageId, async (sync) => {
    const notes = sync.notesJSON(true)
    const blockText = await titles(notes)
    return toMarkdown(page?.title ?? '', notes, (kind, id) => (kind === 'page' ? titleOf(id) : (blockText.get(id) ?? '')))
  })
}

/** Image files become data URLs; large photos are downscaled to max 2000px. */
async function imageToDataUrl(f: File): Promise<string> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })
  if (f.size < 1.5e6 || f.type === 'image/gif' || f.type === 'image/svg+xml') return url
  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
  const out = c.toDataURL('image/webp', 0.86)
  return out.startsWith('data:image/webp') ? out : c.toDataURL('image/jpeg', 0.86)
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Live title of a `[[page]]` or `((block))` reference. Both hooks always run (rules of hooks). */
function useRefTarget(kind: RefKind, id: string) {
  const page = useApp((s) => (kind === 'page' ? s.pages[id] : undefined))
  const block = useBlockInfo(kind === 'block' ? id : null)
  if (kind === 'page') {
    const live = !!page && page.trashedAt == null
    return { title: live ? page.title || 'Untitled' : 'Missing page', icon: live ? page.icon : undefined, missing: !live }
  }
  if (block === undefined) return { title: '…', missing: false }
  return block ? { title: block.text || 'Empty block', missing: false } : { title: 'Missing block', missing: true }
}

function Title({ page, onExit }: { page: Page; onExit: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== page.title) el.textContent = page.title
  }, [page.title])
  useEffect(() => {
    // brand-new, untitled pages start with the caret in the title
    if (!page.title && Date.now() - page.createdAt < 4000) ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])
  return (
    <h1
      ref={ref}
      className="page-title"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-placeholder="Untitled"
      spellCheck={false}
      onInput={(e) => {
        const el = e.currentTarget
        if (el.innerHTML === '<br>') el.innerHTML = ''
        updatePage(page.id, { title: (el.textContent ?? '').replace(/\n/g, ' ') }, 400)
      }}
      onPaste={(e) => {
        e.preventDefault()
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && caretOnLastLine(e.currentTarget))) {
          e.preventDefault()
          onExit()
        }
      }}
    />
  )
}

/**
 * The notes of a page, re-read when notes are added or removed or a note's own fields change
 * (order, display, position), but not on every keystroke inside one.
 */
function useNotes(sync: PageSync | null): NoteRef[] {
  const [notes, setNotes] = useState<NoteRef[]>([])
  useEffect(() => {
    if (!sync) return
    const map = sync.doc.getMap('notes') as Y.Map<Y.Map<unknown>>
    let subs: (() => void)[] = []
    const update = () => {
      subs.forEach((u) => u())
      subs = []
      map.forEach((m) => {
        if (!(m instanceof Y.Map)) return
        const f = (e: Y.YMapEvent<unknown>) => (e.keysChanged.has('order') || e.keysChanged.has('display')) && setNotes(sync.notes())
        m.observe(f)
        subs.push(() => m.unobserve(f))
      })
      setNotes(sync.notes())
    }
    update()
    map.observe(update)
    return () => {
      map.unobserve(update)
      subs.forEach((u) => u())
    }
  }, [sync])
  return notes
}

/** `/Course tracker`: the Courses + Lessons databases, inserted inline. */
function courseTrackerExtra(pageId: string): SlashExtra {
  return {
    id: 'course-tracker',
    label: 'Course tracker',
    desc: 'Start here: Courses + Lessons; import folders of videos as courses',
    keywords: 'template course lessons progress module import folder',
    run: (editor) => {
      toast('Creating the course tracker…')
      void createCourseTracker(pageId).then(
        ({ courses, lessons }) => {
          editor
            .chain()
            .focus()
            .insertContent([
              {
                type: 'callout',
                attrs: { icon: '🎓' },
                content: [
                  {
                    type: 'text',
                    text: 'Add a course with Import folder on Courses: pick a folder of videos and documents, and each file becomes a lesson. New files show up by themselves; press ▶ on a lesson to watch it.',
                  },
                ],
              },
              { type: 'database', attrs: courses },
              { type: 'database', attrs: lessons },
              { type: 'paragraph' },
            ])
            .run()
          toast('Course tracker ready: now Import folder on Courses')
        },
        (e) => toast('Could not create the course tracker: ' + String(e)),
      )
    },
  }
}

export function Editor({ pageId, scrollRef }: { pageId: string; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const page = useApp((s) => s.pages[pageId])
  const spellcheck = useApp((s) => s.spellcheck)
  const width = useApp((s) => s.width)
  const reveal = useApp((s) => s.reveal)
  const words = useApp((s) => s.stats.words)
  const now = useNow(30000)

  const [sync, setSync] = useState<PageSync | null>(null)
  const [error, setError] = useState<string | null>(null)
  const allNotes = useNotes(sync)
  const roles = useRoles()
  const edgeless = useApp((s) => !!s.edgeless[pageId]) && page?.kind !== 'database'
  const notes = useMemo(() => (edgeless ? allNotes : allNotes.filter((n) => n.display !== 'edgeless')), [allNotes, edgeless])
  const editors = useRef(new Map<string, TiptapEditor>())
  const [editorCount, setEditorCount] = useState(0)
  const [picker, setPicker] = useState<{ x: number; y: number; page: boolean; resolve?: (e: string | null) => void } | null>(null)

  // ---------- load / sync ----------

  useEffect(() => {
    let alive = true
    setSync(null)
    setError(null)
    setState({ outline: [], currentHeading: null })
    const s = syncPage(pageId)
    s.ready.then(
      () => alive && setSync(s),
      (e) => alive && setError(String(e)),
    )
    return () => {
      alive = false
      releasePage(pageId)
    }
  }, [pageId])

  // ---------- outline & stats, from all notes ----------

  const notesRef = useRef(notes)
  notesRef.current = notes
  const publishTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Stable (reads refs), so it can stay registered on every note editor.
  const publish = useMemo(
    () => () => {
      clearTimeout(publishTimer.current)
      publishTimer.current = setTimeout(() => {
        const docs = notesRef.current.map((n) => editors.current.get(n.id)?.getJSON()).filter((d) => !!d)
        const outline = docs.flatMap(outlineOf).map((o) => ({ id: o.id, type: `h${o.level}` as 'h1' | 'h2' | 'h3', text: o.text }))
        const st = docs.map(statsOf).reduce((a, b) => ({ words: a.words + b.words, blocks: a.blocks + b.blocks }), { words: 0, blocks: 0 })
        const s = getState()
        if (JSON.stringify(s.outline) !== JSON.stringify(outline)) setState({ outline })
        if (s.stats.words !== st.words || s.stats.blocks !== st.blocks) setState({ stats: st })
      }, 120)
    },
    [],
  )

  // One stable callback per note, so NoteEditor's effect doesn't re-run on every render.
  const callbacks = useRef(new Map<string, (ed: TiptapEditor | null) => void>())
  const editorCallback = (noteId: string) => {
    let cb = callbacks.current.get(noteId)
    if (!cb) {
      cb = (ed) => {
        editors.current.get(noteId)?.off('update', publish)
        if (ed) {
          editors.current.set(noteId, ed)
          ed.on('update', publish)
        } else editors.current.delete(noteId)
        setEditorCount(editors.current.size)
        publish()
      }
      callbacks.current.set(noteId, cb)
    }
    return cb
  }

  // ---------- the host: what the editor package may ask of the app ----------

  const host = useMemo<EditorHost>(
    () => ({
      searchPages: (q) => {
        const query = q.trim().toLowerCase()
        return Object.values(getState().pages)
          .filter((p) => p.trashedAt == null && p.id !== pageId && (!query || (p.title || 'untitled').toLowerCase().includes(query)))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((p) => ({ id: p.id, title: p.title, icon: p.icon }))
      },
      createPage: async (title, opts) => (await createPage({ title, parentId: opts?.subPageOf ? pageId : null, open: false })).id,
      searchBlocks: async (q) =>
        (await db().search(q, 20)).filter((h) => h.blockId).map((h) => ({ id: h.blockId!, pageId: h.pageId, text: h.text })),
      useRefTarget,
      openRef: (kind, id, newTab) => {
        if (kind === 'page') return openPage(id, newTab ? 'tab' : 'replace')
        void blockInfo(id).then((b) => b && openPage(b.pageId, newTab ? 'tab' : 'replace', b.id))
      },
      pickEmoji: (rect) => new Promise((resolve) => setPicker({ x: rect.left, y: rect.bottom, page: false, resolve })),
      readImage: imageToDataUrl,
      openExternal: (url) => void openExternal(url),
      markdownToContent: (text) =>
        markdownToContent(text, (title) => {
          const t = title.toLowerCase()
          return Object.values(getState().pages).find((p) => p.trashedAt == null && p.title.toLowerCase() === t)?.id ?? null
        }),
      // Databases: both kinds start as a sub-page of this page; the inline one is also shown here.
      createDatabase: async () => {
        const db = await createPage({ kind: 'database', title: 'Untitled database', parentId: pageId, open: false })
        const def = await databaseDef(db.id)
        return { databaseId: db.id, viewId: def.views[0]?.id ?? '' }
      },
      DatabaseBlock: ({ databaseId, viewId, editable, onViewChange }) => (
        <DatabaseView databaseId={databaseId} viewId={viewId} onViewChange={onViewChange} editable={editable} inline />
      ),
      WidgetBlock: (props) => <WidgetBlock {...props} pageId={pageId} />,
      // A getter: the slash menu reads it on every keystroke, so newly installed widgets show up.
      get slashExtras() {
        const modules = installedModules()
          .filter((m) => !m.builtin)
          .map((m) => ({
            id: `module:${m.manifest.id}`,
            label: m.manifest.name,
            desc: m.manifest.description || 'Module',
            keywords: `module ${m.manifest.id}`,
            run: (editor: TiptapEditor) => void editor.chain().focus().insertWidget(`module:${m.manifest.id}`).run(),
          }))
        return [courseTrackerExtra(pageId), ...dndSlashExtras, ...modules, ...installedWidgets().map((w) => ({
          id: `widget:${w.manifest.id}`,
          label: w.manifest.name,
          desc: w.manifest.description || 'Widget',
          keywords: `widget ${w.manifest.id}`,
          run: (editor: TiptapEditor) => void editor.chain().focus().insertWidget(w.manifest.id).run(),
        }))]
      },
    }),
    [pageId],
  )
  // ---------- reveal a block / track the current heading ----------

  useEffect(() => {
    if (!sync || !reveal || reveal.pageId !== pageId) return
    // Something drawn on the canvas (found by search): show the canvas, which reveals it.
    if ((sync.doc.getMap('surface') as Y.Map<unknown>).has(reveal.blockId)) {
      if (!edgeless) setState((s) => ({ edgeless: { ...s.edgeless, [pageId]: true } }))
      return
    }
    if (!editorCount || edgeless) return
    const t = setTimeout(() => {
      const el = scrollRef.current?.querySelector(`.bw-prose [data-id="${CSS.escape(reveal.blockId)}"]`) as HTMLElement | null
      setState({ reveal: null })
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 1400)
    }, 60)
    return () => clearTimeout(t)
  }, [sync, editorCount, reveal, pageId, scrollRef, edgeless])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top = sc.getBoundingClientRect().top + 90
        let current: string | null = null
        sc.querySelectorAll('.bw-prose h1[data-id], .bw-prose h2[data-id], .bw-prose h3[data-id]').forEach((h) => {
          if (h.getBoundingClientRect().top < top) current = h.getAttribute('data-id')
        })
        if (getState().currentHeading !== current) setState({ currentHeading: current })
      })
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => sc.removeEventListener('scroll', onScroll)
  }, [scrollRef, editorCount])

  // ---------- focus helpers ----------

  const first = () => (notes[0] ? editors.current.get(notes[0].id) : undefined)
  const last = () => (notes.length ? editors.current.get(notes[notes.length - 1].id) : undefined)

  /** Move the caret to the start of the first note *now* (Tiptap's focus command waits a frame,
   * so fast typing after Enter in the title would still land in the title). */
  const focusFirst = () => {
    const ed = first()
    if (!ed) return
    ed.view.focus()
    ed.view.dispatch(ed.state.tr.setSelection(Selection.atStart(ed.state.doc)).scrollIntoView())
  }

  const tailClick = () => {
    const ed = last()
    if (!ed) return
    const lastNode = ed.state.doc.lastChild
    if (lastNode?.type.name === 'paragraph' && lastNode.content.size === 0) return ed.commands.focus('end')
    ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).focus('end').run()
  }

  // ---------- render ----------

  if (!page) return null
  const themed = isThemed(pageId, roles)
  const readMin = Math.max(1, Math.round(words / 200))

  const emojiPicker = picker && (
    <EmojiPicker
      x={picker.x}
      y={picker.y}
      allowRemove={picker.page}
      onClose={() => {
        picker.resolve?.(null)
        setPicker(null)
      }}
      onPick={(em) => {
        if (picker.page) updatePage(pageId, { icon: em })
        else picker.resolve?.(em || null)
        setPicker(null)
      }}
    />
  )

  if (edgeless) {
    return (
      <div className={`note-scroll edgeless ${themed ? 'dnd-theme' : ''}`} ref={scrollRef}>
        {error && <div className="editor-error">Could not open this page: {error}</div>}
        {sync && <Canvas pageId={pageId} doc={sync.doc} notes={notes} host={host} spellcheck={spellcheck} onEditor={editorCallback} />}
        {emojiPicker}
      </div>
    )
  }

  return (
    <div className={`note-scroll ${themed ? 'dnd-theme' : ''}`} ref={scrollRef}>
      <article className={`note-canvas ${width === 'wide' ? 'wide' : ''}`}>
        <div className="note-meta">
          <span>Updated {relativeTime(page.updatedAt, now)}</span>
          <span>•</span>
          <span>{readMin} min read</span>
        </div>
        <div className="note-icon-wrap">
          <button
            className={page.icon ? 'note-icon' : 'add-icon'}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setPicker({ x: r.left, y: r.bottom, page: true })
            }}
          >
            {page.icon || (
              <>
                <Smile size={14} /> Add icon
              </>
            )}
          </button>
        </div>
        <Title page={page} onExit={focusFirst} />
        {page.databaseId && page.databaseId === charactersDb(roles) ? (
          <CharacterSheet pageId={page.id} />
        ) : page.databaseId && roles[page.id] === 'campaign' ? (
          <CampaignOverview campaignId={page.id} />
        ) : (
          page.databaseId && <RowProperties rowId={page.id} databaseId={page.databaseId} />
        )}
        {page.kind === 'database' ? (
          <DatabaseView databaseId={page.id} />
        ) : (
          <div className="blocks">
            {error && <div className="editor-error">Could not open this page: {error}</div>}
            {sync &&
              notes.map((n) => (
                <NoteEditor
                  key={n.id}
                  fragment={n.fragment}
                  host={host}
                  spellcheck={spellcheck}
                  onEditor={editorCallback(n.id)}
                />
              ))}
          </div>
        )}
        {page.kind !== 'database' && <div className="editor-tail" onClick={tailClick} />}
      </article>

      {emojiPicker}
    </div>
  )
}
