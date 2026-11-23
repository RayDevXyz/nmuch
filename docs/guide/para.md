# PARA: a how-to

PARA is Tiago Forte's way of sorting everything you keep into four places:

- **Projects:** things with a goal and a deadline ("Run a marathon by April").
- **Areas:** parts of your life you keep up, with no end date ("Health", "Home").
- **Resources:** topics you collect for later ("Running plans", "Design inspiration").
- **Archive:** anything from the other three that isn't active any more.

BrainWaves adds an **Inbox** in front of it: capture first, sort later.

## 1. Set it up (once)

Click **PARA** in the left rail (the folder icon), then **Set up PARA**. You get a **PARA** page
with four databases under it: Inbox, Projects, Areas and Resources.

The PARA panel in the sidebar, and the PARA page itself, show:

- a **capture box**: type a thought and press Enter, it lands in the Inbox;
- **Inbox, Projects, Areas, Resources**: each opens its database on its main view, with how
  many items are in it (and an orange badge for overdue projects and reviews);
- **Archive**: everything archived, from all four, newest first, with a restore button;
- **To triage**: the notes waiting in the Inbox, with buttons to sort them;
- **Reviews due**: areas whose review is overdue, with a button to mark them reviewed;
- **Areas**: each area's health and how many active projects it has;
- **Next actions**: active projects, soonest deadline first, with their next action.

## 2. Capture

Anything goes in the Inbox: type in the capture box, or click **New** in the Inbox database. Pinned notes stay at the top; otherwise the newest come first.

A new note shows no properties at first, so it is quick to write in. Click **Properties** under
the title to see them: type (idea, scratchpad, reference, meeting), the projects, areas and
resources it links to, a source link, a pin and tags.

## 3. Triage

Hover a note in **To triage** (or open it) and pick one:

| Button | What happens |
|---|---|
| 🚀 **Promote to project** | Fill in the outcome, the next action, a deadline and an area. The note *becomes* the project: same page, so its text, tags and links come along, and it leaves the Inbox. If you don't pick an area, the note's first linked area is used. |
| ✓ **Link & process** | Tick the projects, areas and resources it belongs to. It leaves the Inbox and shows up on each of them under **Notes**. |
| 🗄 **Archive** | Not needed any more. Choose a reason. |

Notes you want to keep for later but not now: set their status to **Someday**. They wait in the
Inbox database's **Someday** view.

## 4. Projects

Each project has a **status** (not started, in progress, on hold, completed, canceled), a
**deadline**, an **area**, an **outcome** (what done looks like) and a **next action**. Priority,
review date, timeframe (Q1–Q4) and stakeholders are there too, but hidden until you use them:
click **N more** on a project, or show the columns in a view.

Views: **Active projects** (by deadline), **Board** (by status) and **Archive**.

## 5. Areas

Each area has the **standard** you want to keep, its **health** (on track, needs attention,
critical), a **review cadence** (weekly, monthly, quarterly) and when you **last reviewed** it.
An area is **overdue** when more time than its cadence has passed since its last review (or it
was never reviewed). Open it and click **Mark reviewed**, or use the button in **Reviews due**.

The **Areas dashboard** view puts the areas that need attention first, then the ones reviewed
longest ago. An area's projects and notes are listed on it.

## 6. Resources

Each resource has a **domain** (type a new one to add it) and a **type** (wiki, asset/template,
bookmark, media/course), and can link to areas and projects. Views: **Library** (recently changed
first), **By domain** and **Archive**.

## 7. The archive

**Archive** on any item asks for a reason (completed, canceled, on ice, deprecated) and notes the
date. Archiving a project as completed or canceled sets its status to match.

An archived item leaves the lists, the sidebar tree and the PARA panel, but links to it keep
working: it stays in backlinks and the graph, shown muted. Restore it from the **Archive** list in
the PARA panel, the database's **Archive** view, or **Restore** on the item itself.

## Good to know

- Everything is ordinary databases: add columns, views and filters as you like. Keep the columns
  PARA made (renaming them is fine) and the triage buttons keep working.
- The PARA databases can be shown on any other page with **/linked database**.
- For developers: the module is `crates/bw-core/src/para.rs` (commands `paraSetup`,
  `paraOverview`, `paraPromote`, `paraProcess`, `paraArchive`, `paraUnarchive`, `paraReviewed`).
