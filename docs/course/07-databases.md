# Databases

*Module 3: Structure · about 20 minutes*

A **database** is a page whose rows are pages too. Each row has cells in typed columns, and you
can look at the same rows as a **table**, a **board** or a **gallery**. Use one for anything you
have many of: books, tasks, meetings, recipes, contacts.

## Learn

- **Make one:** `/database` puts one inside the page you're on; `/database page` makes it its
  own page. A page's **⋯ → Turn into database** turns its sub-pages into rows.
- **Rows:** **New** adds one. Open a row (the **Open** button next to its name) to write in it like any page;
  its cells sit under the title.
- **Columns:** **+** at the end of the header adds one. Types: text, number, select,
  multi-select, date, checkbox, link, file, relation and rollup. Click a column's name to rename it,
  change its type or remove it.
- **Views:** **+** next to the view tabs adds a table, board or gallery. Each view has its own
  **Filter** and **Sort**, and the sliders icon shows or hides columns and (for a board) picks
  the column to group by.
- **Relations** link rows of two databases: a book to its author, a task to its project. Both
  sides show the link.
- **Rollups** count, total or average over linked rows: an author's number of books, a project's
  share of finished tasks.

## Try it

- [ ] Make a "Reading list" with `/database page`.
- [ ] Add columns: **Author** (text), **Status** (select: To read, Reading, Read), **Pages**
  (number), **Rating** (number).
- [ ] Add four books with **New**, and fill in their cells.
- [ ] Add a **Board** view grouped by **Status**, and drag a card to another column.
- [ ] Add a filter to the table: only books with Status = Read.
- [ ] Sort by Rating, highest first.
- [ ] Open a book as a page and write a few notes about it.
- [ ] Make a second database "Authors", and a **relation** from Reading list to Authors.

> [!TIP]
> Now go back to lesson 6 and try `{{= [[Reading list]].count(Status = "Read")}}` in a page.

## Learn more

- [Databases](../guide/databases.md)
