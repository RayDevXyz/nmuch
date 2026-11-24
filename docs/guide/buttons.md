# Buttons

A button does something when you click it: make a quick note, add a to-do to your journal, add a
row to a database, open a page. Type **/button** in a page; its settings open right away.

## How it looks

- **Label** and **icon** (an emoji).
- **Colour**: the theme colour, one of the swatches, or any colour.
- **Style**: *Solid*, *Soft* (a light fill), *Outline* or *Plain*.
- **Width**: fits the label, or the full width of the page.

The ⚙ next to the button (shown when you point at it) opens the settings again.

## What it does: steps

A button runs its steps in order. Each step says **what** to do, **where**, and the **extras**.

| What | Where | Extras |
|---|---|---|
| **Create a page** | under this page · at the top level · under a page you pick · as a row of a database | a title, a template, an icon and tags (for a page) or column values (for a row), and whether to open it (new tab, here, or not at all) |
| **Add text or a to-do** | under the button · in the page an earlier step made · in a page you pick (at the start or the end) | the text, as text, a to-do, a bullet, a heading or a quote |
| **Open a page or link** | a page you pick, or a web address | |

For a database row, **Template** offers *the database's own template* (its
[Template for new pages](databases.md#new-pages-from-a-template)), *None*, or any template.

**Message when done** replaces the short summary shown after a click (fields work here too).

## Fields

Every text can use fields:

- filled in for you: `{{date}}`, `{{time}}`, `{{date:dddd D MMMM}}`, `{{tomorrow}}`, `{{date+7}}`,
  `{{title}}` (the page the button is on);
- asked when you click: any other name, like `{{Topic}}`, `{{Due: date}}` or
  `{{Priority: Low | High}}`. A small form opens under the button; each field is asked once and
  used in every step.

## Examples

**Create quick note**: *Create a page* under this page, title `Note {{date}} {{time}}`, open it in
a new tab.

**Quick note with a topic**: as above, title `{{Topic}}`; then *Add text* in the page an earlier
step made, as a heading, `{{Topic}}`.

**Log a task**: *Create a page* as a row of *Tasks*, title `{{Task}}`, Status *To do*, Due
*Today*, don't open it; message `Added {{Task}}`.

**Daily log line**: *Add text* in your *Journal* page, at the end, as a to-do, `{{time}} {{What}}`.

A button in a template keeps its fields: `{{date}}` is the day you click it, not the day the
page was made.
