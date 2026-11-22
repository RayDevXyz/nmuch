# Databases

A database is a page whose rows are pages too. Each row has cells in typed columns: text, number, select, multi-select, date, checkbox, link, file, relation and rollup. Show the rows as a table, a board or a gallery, each a **view** with its own filters, sorting and grouping.

## Making one

- **`/database`:** a database inside the current page.
- **`/database page`:** a database as its own page, linked from here.
- **Turn into database:** an existing page, in its ⋯ menu (below).

**Working in a database:**
- **Rows:** add one with **New**.
- **Cells:** click a cell to edit it.
- **Columns:** click a column's heading to rename it, change its type or remove it, and use **+** to add one.
- **Views:** add one with **+** next to the view tabs. Click the active tab for its settings: filters, sorting, grouping and hidden columns.
- **Row pages:** open a row to write in it as a page. Its cells sit under its title.

Relations link rows of two databases, both ways if you like, and rollups count or total over linked rows. A database can also feed [formulas](formulas.md) and [maps of content](maps-of-content.md). How databases are built is in [design/phase-03-databases.md](../design/phase-03-databases.md).

## Turning a page into a database

From a page's **⋯** menu, choose **Turn into database**:
- The page's **sub-pages become its rows**. They are the same pages with the same content, and now they have cells.
- The page's own text stays and is shown above the table.
- Sub-pages that are databases themselves stay sub-pages.
- The new database gets a **Name** column and a table view.

**Turn into page** reverses it: the rows become sub-pages again. Their cell values and the database's columns and views are kept in storage, so turning the page into a database once more brings them all back.

| API command | Arguments | Result |
|---|---|---|
| `convertToDatabase` | `{ pageId }` | ids of the pages that became rows |
| `convertToPage` | `{ databaseId }` | ids of the rows that became sub-pages |

A database row can't become a database, and a database can't be converted twice.

## Showing a database on other pages

A database lives on one page, but you can show it on as many pages as you like:
- **`/linked database`:** pick a database. Then pick either **A new view just for this page** or one of the database's views.
  - **A new view just for this page:** a copy of its first view, named after the page. Its filters, sorts and grouping change only that view.
  - **One of the database's views:** a shared view. Changing its filters or sorts changes it everywhere it's shown.
- **Drag a database from the sidebar** into a page: it shows there too. Dragging an ordinary page in adds a link to it.

**How a linked database behaves:**
- **Same rows everywhere:** the rows stay in the database. Adding a row, editing a cell or renaming a row in a linked view changes the database, and every other place shows the change.
- **The label:** a linked database's heading has a small **↗ Linked** label. Click the heading to open the database itself.
- **Removing it** from a page never deletes the database.

**Under the hood:** it's the same `database` block, which holds the database's id and the view's id (`viewId`; empty means the first view). "Linked" just means the database's page isn't this page. See `apps/desktop/src/database/LinkDatabase.tsx`.
