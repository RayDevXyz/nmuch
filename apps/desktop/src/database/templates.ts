import { courseSetup, refreshTrackers } from '../modules/api'

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
 * Both databases become sub-pages of `parentId`. They start empty: **Import folder** on the
 * Courses database adds courses (see docs/guide/courses.md).
 */
export async function createCourseTracker(parentId: string | null): Promise<CourseTracker> {
  const t = await courseSetup(parentId)
  void refreshTrackers()
  return { courses: { databaseId: t.courses, viewId: t.coursesView }, lessons: { databaseId: t.lessons, viewId: t.lessonsView } }
}
