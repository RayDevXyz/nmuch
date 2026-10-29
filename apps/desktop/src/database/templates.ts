import { uid } from '../lib/id'
import { createPage } from '../state/actions'
import { createRelation, createRow, databaseDef, setProperty, setView } from './api'

export interface CourseTracker {
  courses: { databaseId: string; viewId: string }
  lessons: { databaseId: string; viewId: string }
}

/**
 * The Course module's data, as two related databases (this is what the Course module in
 * phase 6 builds on):
 *
 * - Courses: Name, Status (select), Source folder (file path), Lessons (the other side of the
 *   relation), Progress (% of lessons done), Total minutes, Lessons done.
 * - Lessons: Name, Course (relation), Order, Done, Duration (min), File, Last watched.
 *
 * Both databases become sub-pages of `parentId`. One example course with three lessons is
 * added so the progress bar has something to show.
 */
export async function createCourseTracker(parentId: string | null): Promise<CourseTracker> {
  const courses = await createPage({ kind: 'database', title: 'Courses', icon: '🎓', parentId, open: false })
  const lessons = await createPage({ kind: 'database', title: 'Lessons', icon: '🎬', parentId, open: false })
  const C = courses.id
  const L = lessons.id

  await setProperty(C, {
    id: 'status',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'todo', name: 'Not started', color: 'gray' },
      { id: 'doing', name: 'In progress', color: 'blue' },
      { id: 'done', name: 'Finished', color: 'green' },
    ],
  })
  await setProperty(C, { id: 'folder', name: 'Source folder', type: 'file' })
  await setProperty(L, { id: 'order', name: 'Order', type: 'number' })
  await setProperty(L, { id: 'done', name: 'Done', type: 'checkbox' })
  await setProperty(L, { id: 'minutes', name: 'Duration (min)', type: 'number' })
  await setProperty(L, { id: 'file', name: 'File', type: 'file' })
  await setProperty(L, { id: 'watched', name: 'Last watched', type: 'date' })

  const rel = await createRelation(L, { name: 'Course', targetDatabase: C, twoWay: true, reverseName: 'Lessons' })
  const lessonsCol = rel.reversePropertyId!
  // Show the Course column right after the name.
  const courseCol = (await databaseDef(L)).properties.find((p) => p.id === rel.propertyId)!
  await setProperty(L, { ...courseCol, order: 'a05' })
  await setProperty(C, { id: 'progress', name: 'Progress', type: 'rollup', rollup: { relation: lessonsCol, property: 'done', function: 'percentChecked' } })
  await setProperty(C, { id: 'minutes', name: 'Total minutes', type: 'rollup', rollup: { relation: lessonsCol, property: 'minutes', function: 'sum' } })

  // Views: courses as a table and a board by status; lessons ordered, plus "To watch".
  const cDef = await databaseDef(C)
  const lDef = await databaseDef(L)
  const cTable = cDef.views[0]
  const lTable = lDef.views[0]
  await setView(C, { id: uid(), name: 'Board', type: 'board', order: '', filters: [], sorts: [], groupBy: 'status', hidden: ['folder', lessonsCol, 'minutes'] })
  await setView(L, { ...lTable, sorts: [{ property: 'order' }] })
  await setView(L, {
    id: uid(),
    name: 'To watch',
    type: 'table',
    order: '',
    filters: [{ property: 'done', op: 'is', value: false }],
    sorts: [{ property: 'order' }],
    hidden: ['done', 'file', 'watched'],
  })

  // An example course.
  const course = uid()
  await createRow(C, course, 'Example course', { status: 'doing', folder: '~/Courses/example' })
  const lessonsData: [string, boolean, number][] = [
    ['Welcome', true, 5],
    ['Getting set up', true, 12],
    ['First project', false, 25],
  ]
  for (const [i, [title, done, minutes]] of lessonsData.entries()) {
    await createRow(L, uid(), title, { order: i + 1, done, minutes, [rel.propertyId]: [course] })
  }

  return { courses: { databaseId: C, viewId: cTable.id }, lessons: { databaseId: L, viewId: lTable.id } }
}
