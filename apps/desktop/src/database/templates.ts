import { uid } from '../lib/id'
import { courseSetup, refreshTrackers } from '../modules/api'
import { createRow } from './api'

export interface CourseTracker {
  courses: { databaseId: string; viewId: string }
  lessons: { databaseId: string; viewId: string }
}

/**
 * `/course`: a course tracker made by the Course module (`crates/bw-core/src/course.rs`):
 *
 * - Courses: Name, Status, Source folder, Lessons, Progress (% of lessons done), Total minutes.
 * - Lessons: Name, Course, Order, Section, Done, Duration (min), File, Last watched, Missing.
 *
 * Both databases become sub-pages of `parentId`. One example course with three lessons is
 * added so the progress bar has something to show; **Import folder** on the Courses database
 * adds real ones.
 */
export async function createCourseTracker(parentId: string | null): Promise<CourseTracker> {
  const t = await courseSetup(parentId)
  void refreshTrackers()
  const course = uid()
  await createRow(t.courses, course, 'Example course', { status: 'doing' })
  const lessonsData: [string, boolean, number][] = [
    ['Welcome', true, 5],
    ['Getting set up', true, 12],
    ['First project', false, 25],
  ]
  for (const [i, [title, done, minutes]] of lessonsData.entries()) {
    await createRow(t.lessons, uid(), title, { order: i + 1, done, minutes, [t.link]: [course] })
  }
  return { courses: { databaseId: t.courses, viewId: t.coursesView }, lessons: { databaseId: t.lessons, viewId: t.lessonsView } }
}
