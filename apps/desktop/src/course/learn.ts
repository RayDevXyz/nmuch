import { markdownToContent } from '../lib/convert'
import { createPage, openPage, updatePage, withPage } from '../state/actions'
import { getState, toast } from '../state/store'

/**
 * "Learn BrainWaves": the course in `docs/course/` (one Markdown file per lesson, plus a
 * README that is the course's front page), made into pages in the workspace: a course page and
 * one sub-page per lesson, whose "Try it" lists are to-dos to tick off. The same files are what
 * GitHub shows, so the course is written once.
 */

export const COURSE_TITLE = 'BrainWaves Course'
const DOCS = 'https://github.com/RayDevXyz/nmuch/blob/main/docs/'

// Loaded only when the course is made, so the lessons don't weigh on every start.
const files = import.meta.glob('../../../../docs/course/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

const nameOf = (path: string) => path.split('/').pop()!

/** The course page, if it was made already (top level, not in the trash). */
export function coursePage() {
  return Object.values(getState().pages).find((p) => !p.parentId && p.trashedAt == null && p.title === COURSE_TITLE) ?? null
}

const waitFor = async (id: string) => {
  for (let i = 0; i < 50 && !getState().pages[id]; i++) await new Promise((r) => setTimeout(r, 100))
}

let making: Promise<void> | null = null

/** How many lessons this build of the app carries (0: it was built without docs/course). */
export const LESSON_COUNT = Object.keys(files).filter((p) => /\/\d+-[^/]*\.md$/.test(p)).length

/**
 * Open the course, making it first if it isn't there yet. A course page without its lessons (made
 * by a build that lacked them) is filled in rather than opened empty.
 */
export function learnBrainWaves(): Promise<void> {
  if (!LESSON_COUNT) {
    toast('This build of BrainWaves has no course lessons in it. Rebuild it with the docs/course folder, or read the course on GitHub: docs/course.')
    return Promise.resolve()
  }
  const found = coursePage()
  const filled = found && Object.values(getState().pages).some((p) => p.parentId === found.id && p.trashedAt == null)
  if (found && filled) {
    openPage(found.id, 'tab')
    return Promise.resolve()
  }
  making ??= make(found?.id ?? null).finally(() => (making = null))
  return making
}

async function make(existing: string | null) {
  toast('Making the course…')
  const loaded = await Promise.all(Object.entries(files).map(async ([path, load]) => [nameOf(path), await load()] as const))
  const index = loaded.find(([n]) => n === 'README.md')?.[1] ?? `# ${COURSE_TITLE}`
  const lessons = loaded.filter(([n]) => /^\d+-.*\.md$/.test(n)).sort(([a], [b]) => a.localeCompare(b))
  if (!lessons.length) throw new Error('No course lessons in this build')

  // Lesson titles: "1. Your first page", from each file's first heading.
  const titles = new Map<string, string>()
  for (const [name, md] of lessons) {
    const n = Number(name.split('-')[0])
    const h1 = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name
    titles.set(name, `${n}. ${h1.replace(/^Final project:\s*/i, 'Final project: ')}`)
  }

  // An empty course page left by an earlier build is reused (it keeps its place and its links).
  const course = existing ? getState().pages[existing]! : await createPage({ title: COURSE_TITLE, icon: '🎓', open: false })
  await waitFor(course.id)
  if (existing && !course.icon) updatePage(course.id, { icon: '🎓' })
  const ids = new Map<string, string>()
  for (const [name] of lessons) {
    const page = await createPage({ parentId: course.id, title: titles.get(name)!, icon: '📘', open: false })
    ids.set(name, page.id)
  }
  for (const id of ids.values()) await waitFor(id)

  const byTitle = new Map([...titles.entries()].map(([name, t]) => [t.toLowerCase(), ids.get(name)!]))
  const resolve = (t: string) => byTitle.get(t.toLowerCase()) ?? null
  /** The Markdown as a page: no top heading; links to lessons become page links, to the guides web links. */
  const prepare = (md: string) =>
    md
      .replace(/^#\s+.+\n+/, '')
      .replace(/\[([^\]]+)\]\((\d+-[\w-]+\.md)\)/g, (all, _text, file) => (titles.has(file) ? `[[${titles.get(file)}]]` : all))
      .replace(/\]\(\.\.\/(guide\/[\w-]+\.md|README\.md)([^)]*)\)/g, (_all, path, hash) => `](${DOCS}${path}${hash})`)
  const write = async (pageId: string, md: string) => {
    const content = markdownToContent(prepare(md), resolve)
    if (!content) return
    await withPage(pageId, (s) => {
      s.setContent({ type: 'doc', content })
      return s.flush()
    })
  }

  for (const [name, md] of lessons) await write(ids.get(name)!, md)
  // The README's tip says how to get here: not needed once you are.
  await write(course.id, index.replace(/> \[!TIP\]\n> Take the course inside the app[\s\S]*?\n\n/, ''))
  openPage(course.id, 'tab')
  toast('The course is ready: start with lesson 1')
}
