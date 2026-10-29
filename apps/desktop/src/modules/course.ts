import { useMemo } from 'react'
import { toast } from '../state/store'
import { chooseFolderFor, COURSE_MODULE, courseImport, courseOpenLesson, courseSync, useCourseRole } from './api'

const describe = (r: { added: number; missing: number; restored: number }) =>
  [r.added && `${r.added} new lesson${r.added === 1 ? '' : 's'}`, r.missing && `${r.missing} missing`, r.restored && `${r.restored} back`]
    .filter(Boolean)
    .join(', ') || 'up to date'

const message = (e: unknown) => String(e).replace(/^Error:\s*/, '')

/**
 * What the Course module offers on a database of a course tracker: importing a folder (on
 * Courses), opening a lesson's file (on Lessons), syncing a course with its folder.
 */
export function useCourseActions(databaseId: string) {
  const found = useCourseRole(databaseId)
  return useMemo(() => {
    if (!found) return null
    const { tracker, role } = found
    return {
      role,
      async importFolder() {
        try {
          const folder = await chooseFolderFor(COURSE_MODULE, 'Choose a course folder')
          if (!folder) return
          toast('Importing…')
          const r = await courseImport(tracker.courses, folder)
          toast(`Course imported: ${describe(r)}`)
        } catch (e) {
          toast(`Could not import: ${message(e)}`)
        }
      },
      openLesson(rowId: string) {
        courseOpenLesson(rowId).then(
          (r) => toast(r.opened ? `Opening ${r.path.split(/[\\/]/).pop()}` : `Marked as watched (couldn't open ${r.path})`),
          (e) => toast(`Could not open: ${message(e)}`),
        )
      },
      sync(courseId: string) {
        courseSync(courseId).then(
          (r) => toast(`Synced: ${describe(r)}`),
          (e) => toast(`Could not sync: ${message(e)}`),
        )
      },
    }
  }, [found])
}
