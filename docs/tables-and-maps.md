# Tables, page databases and maps of content

Three additions to the editor:
- a simple **table** block;
- turning a **page into a database**, and back;
- a **map of content** block that keeps itself up to date.

## Simple tables

Type `/table` to insert a 3 × 3 table with a header row.

- **Moving around:** Tab goes to the next cell and Shift+Tab to the previous one. Tab in the last cell adds a row.
- **Toolbar:** while the cursor is in a table, a toolbar sits above it. It can:
  - add rows above or below, and delete a row;
  - add columns left or right, and delete a column;
  - turn the header row on or off;
  - merge and split cells;
  - delete the table.
- **Column widths:** drag the border between two columns.
- **Pasting:** pasting a Markdown table (`| a | b |`, then a `| --- | --- |` line) makes a table.
- **Copying:** "Copy as Markdown" writes a GitHub-style table.

A table holds plain blocks, not database columns. For sorting, filtering, typed columns or rows that are pages, use a database (`/database`).

**In the page schema:** `table` > `tableRow` > `tableHeader` | `tableCell` > blocks (usually one paragraph).
- Every one of these nodes has a block id.
- Cells carry `colspan`, `rowspan` and `colwidth`.
- The Rust core lists the same nodes (`schema::node::TABLE*`), and the contract fixtures cover them.

## Turn a page into a database

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

## Map of content

Type `/map of content` (or `/moc`) to insert one. The block stores only its settings. It works the list of pages out from the workspace every time, so new, renamed, moved, archived or tagged pages show up, or drop out, on their own.

Open the settings with the gear in its top-right corner. The choices:

| Setting | Options |
|---|---|
| Show | sub-pages of this page (default) · pages with a tag (in the text or in a Tags property) · rows of a database · all pages |
| Levels | 1–3: nest sub-pages of sub-pages (for sub-pages and all pages) |
| Sort | as in the sidebar · A–Z · last updated · created |
| Group | none · first letter · parent page |
| Style | list · columns · cards |
| Title | your own heading; otherwise one is chosen from the source |

Clicking a link opens the page. Ctrl or Cmd+click opens it in a new tab.

When the page is copied as Markdown, the map becomes a bulleted list of `[[page]]` links, as it looks at that moment.

**Limit:** the links are worked out live, so the index doesn't store them. They don't appear as backlinks or in the graph.

**In the page schema:** the node is `moc`, and its attribute `settings` is a JSON string (see `apps/desktop/src/moc/MocBlock.tsx`, `MocSettings`).

## Columns

Type `/columns` and pick **2 columns**, **3 columns** or **4 columns**. If the line you're on has text, it moves into the first column. Each column holds any blocks: text, lists, images, tables, databases. You can drag blocks in and out of columns with the block handle.

- **Resize:** drag the line between two columns.
- **Add a column:** click the **+** at the right of the row (up to 5).
- **Remove a column:** empty it, then press **Backspace** at its start. When one column is left, the row turns back into plain blocks.
- **Phone:** columns stack on narrow screens.
- **Markdown:** "Copy as Markdown" writes the columns one after the other.

**In the page schema:** `columns` (attribute `widths`: relative widths such as `1,2`) > `column` > blocks. Both sides of the schema list them, and the contract fixtures cover them.
