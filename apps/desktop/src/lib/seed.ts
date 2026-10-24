import { keysBetween } from './fractional'
import { blocksToDoc } from './convert'
import { uid } from './id'
import type { BlockProps, BlockType, Page, Storage } from './types'
import type { PageSync } from './core/page-sync'

const link = (id: string, title: string) => `<a class="page-link" data-page="${id}" contenteditable="false">${title}</a>`

/** Sample pages for an empty workspace. */
export async function seed(storage: Storage, open: (pageId: string) => Promise<PageSync>) {
  const now = Date.now()
  const mk = (title: string, icon: string, parentId: string | null = null, ago = 0): Page => ({
    id: uid(),
    parentId,
    title,
    icon,
    key: '',
    favorite: false,
    archived: false,
    trashedAt: null,
    createdAt: now - ago,
    updatedAt: now - ago,
  })
  const start = mk('Getting Started', '🧭')
  const atlas = mk('Project Atlas', '📁', null, 3600e3)
  const reading = mk('Reading List', '📚', null, 7200e3)
  const ideas = mk('Ideas & Sketches', '💡', null, 86400e3)
  const weekly = mk('Weekly review', '🗓️', atlas.id, 1800e3)
  const roots = [start, atlas, reading, ideas]
  keysBetween(null, null, roots.length).forEach((k, i) => (roots[i].key = k))
  weekly.key = keysBetween(null, null, 1)[0]
  start.favorite = true

  type Spec = [BlockType, string, BlockProps?]
  const content: Record<string, Spec[]> = {
    [start.id]: [
      ['text', 'A calm place to capture what matters, connect your ideas, and make space for better thinking.'],
      ['callout', '<b>Make it yours</b><br>Use this space for a daily journal, a project hub, or anything you want to remember.', { icon: '✨' }],
      ['h2', 'A calm place to think'],
      ['text', 'BrainWaves keeps your notes close and your attention focused. Everything is organized into flexible documents built from <b>blocks</b> — every paragraph, heading, list item and image is one.'],
      ['bullet', 'Write in a clean, distraction-free editor'],
      ['bullet', 'Connect ideas with backlinks — type <code>[[</code> to link a page, e.g. ' + link(atlas.id, 'Project Atlas')],
      ['bullet', 'Link a single block with <code>((</code> and search for its text'],
      ['bullet', 'Tag anything with a hashtag like #welcome and find it under Tags'],
      ['bullet', 'Find anything instantly with quick search (<code>Ctrl K</code>)'],
      ['h2', 'Capture everything'],
      ['text', 'From fleeting thoughts to fully formed plans, your workspace adapts to the way you work. Start simple and let your system grow with you.'],
      ['callout', '<b>Try a slash command</b><br>Type <code>/</code> on an empty line to insert a block, or use Markdown: <code>#</code>, <code>-</code>, <code>1.</code>, <code>[]</code>, <code>&gt;</code>, <code>!&gt;</code>, <code>```</code>.', { icon: '⌘' }],
      ['todo', 'Create your first page', { checked: true }],
      ['todo', 'Drag a block by its handle to reorder it'],
      ['todo', 'Select text to format it — bold, italic, code, links'],
      ['divider', ''],
      ['h2', 'Build your second brain'],
      ['text', 'Link related notes, add context as you go, and turn scattered thoughts into a map you can return to. Your knowledge is more powerful when it is connected — open the graph on the right to see it.'],
      ['quote', 'Everything is stored locally: every edit is a Yjs update in a SQLite file on your machine, and the search index is rebuilt from it. No account, no cloud.'],
    ],
    [atlas.id]: [
      ['text', 'Planning hub for the Atlas project. Background reading lives in ' + link(reading.id, 'Reading List') + '. #project'],
      ['h2', 'Milestones'],
      ['numbered', 'Research and scope'],
      ['numbered', 'First prototype'],
      ['numbered', 'Feedback round'],
      ['h2', 'Notes'],
      ['text', 'See ' + link(start.id, 'Getting Started') + ' for how linking works.'],
      ['code', 'const atlas = { status: "planning", owner: "me" }', { lang: 'js' }],
      ['page', '', { pageId: weekly.id }],
    ],
    [reading.id]: [
      ['text', 'Books and articles to get through. #reading'],
      ['todo', 'How to Take Smart Notes'],
      ['todo', 'Building a Second Brain'],
      ['todo', 'The Art of Doing Science and Engineering'],
    ],
    [ideas.id]: [
      ['text', 'Loose ideas. Some of these could become part of ' + link(atlas.id, 'Project Atlas') + '. #ideas'],
      ['bullet', 'A visual timeline view'],
      ['bullet', 'Daily notes template'],
      ['text', 'Revisit the Getting Started page when onboarding someone new.'],
    ],
    [weekly.id]: [
      ['h2', 'This week'],
      ['todo', 'Review open tasks'],
      ['todo', 'Update ' + link(atlas.id, 'Project Atlas') + ' milestones'],
    ],
  }

  for (const p of [...roots, weekly]) await storage.createPage(p)
  for (const p of [...roots, weekly]) {
    const specs = content[p.id] ?? []
    const sync = await open(p.id)
    sync.setContent(blocksToDoc(specs.map(([type, text, props]) => ({ type, text, props: props ?? {} }))))
    await sync.flush()
  }
}
