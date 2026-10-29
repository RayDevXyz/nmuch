# Courses: a how-to

Turn folders of course videos (and PDFs, slides, notes) into courses you can track: which
lessons you've watched, what's next, how far you are.

## 1. Create a course tracker (once)

In any page, type **`/course`** and choose **Course tracker**. Not *Course dashboard*: that one
only shows courses once you have a tracker.

You get two databases in the page:
- **Courses:** one row per course, with its status and progress.
- **Lessons:** one row per lesson.

They're also in the sidebar, under the page.

## 2. Import a course folder

On **Courses**, click **Import a course folder** (or **Import folder** in its toolbar), then
pick a folder.

**What becomes a lesson**

| Part of the folder | Becomes |
|---|---|
| Each video (mp4, mkv, webm, mov, m4v, avi) and document (pdf, slides, md, txt, html, docx, epub) | A lesson |
| Images, subtitles and hidden files | Nothing (skipped) |
| The file's place in the folder | The lesson's **order**, in natural order: `2 - Intro` comes before `10 - Outro` |
| The subfolder a file is in | The lesson's **section**, e.g. "Part 2 - Ownership" |
| The file name | The **title**, cleaned up: `01 - Getting_started.mp4` → "Getting started" |
| An MP4 or MOV file's length | Its **duration** in minutes, read from the file |

**The folder stays connected:**
- **New files** you add become lessons by themselves.
- **Lessons whose file disappears** are marked **missing**. They're never deleted, so your ticks
  stay.
- **A file that comes back** clears the mark.

Importing the same folder again just syncs it. On a course's page, **Sync with folder** does the
same on demand.

Import every course you have, one folder each.

## 3. Watch and track

| To | Do |
|---|---|
| Watch a lesson | Press **▶** next to its file, or open the lesson and press **Open lesson**. It opens in your video player, sets *Last watched* to today, and a *Not started* course becomes *In progress*. |
| Mark it done | Tick **Done**. The course's **Progress** updates straight away. |
| See what's left | The **To watch** view of Lessons shows the lessons not done yet, in order. |
| Group courses by status | The **Board** view of Courses |
| See progress elsewhere | `/course dashboard` shows a card per course with its progress, and `/progress` shows a bar, in any page |

## 4. Your folders and privacy

The Course module can only read folders **you picked**. It never moves, renames or deletes your
files.

To see or remove the folders it has, go to **⚙ → Modules… → Courses**.

## Troubleshooting

**"/course dashboard asks me to choose a database, but there's nothing to pick."**
Create a tracker first (step 1). The dashboard then picks your Courses database by itself.

**A lesson shows *missing*.**
Its file was moved or renamed. Put it back to clear the mark. A renamed file also shows up once
more, as a new lesson.

**▶ says it couldn't open the file.**
The lesson is still marked as watched. Check that the folder is reachable; for example, that the
drive is plugged in.
