# Writing in pages: tables, columns and callouts

Pages are made of blocks. Type `/` anywhere to insert one: headings, lists, to-dos, quotes, code, images, sub-pages, databases, widgets and more. Drag a block by its handle (left of it) to move it. Markdown shortcuts work as you type (`#`, `-`, `1.`, `[]`, `>`, `!>`, ` ``` `, `---`), and pasted Markdown becomes blocks.

This guide covers three kinds of blocks with more to them:
- [Tables](#simple-tables)
- [Columns](#columns)
- [Callouts](#callouts)

Related guides:
- [Databases](databases.md): tables with typed columns, views and rows that are pages.
- [Maps of content](maps-of-content.md): lists of pages that keep themselves up to date.
- [Formulas](formulas.md): live values in your text.

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

## Columns

Type `/columns` and pick **2 columns**, **3 columns** or **4 columns**. If the line you're on has text, it moves into the first column. Each column holds any blocks: text, lists, images, tables, databases. You can drag blocks in and out of columns with the block handle.

- **Resize:** drag the line between two columns.
- **Add a column:** click the **+** at the right of the row (up to 5).
- **Remove a column:** empty it, then press **Backspace** at its start. When one column is left, the row turns back into plain blocks.
- **Phone:** columns stack on narrow screens.
- **Markdown:** "Copy as Markdown" writes the columns one after the other.

**In the page schema:** `columns` (attribute `widths`: relative widths such as `1,2`) > `column` > blocks. Both sides of the schema list them, and the contract fixtures cover them.

## Callouts

Type `!> ` at the start of a line, or use `/callout`, for a highlighted box with an icon. Click the icon to change it.

To change its colour and style, hover over the callout and click the colour dot in its corner. The menu has:
- **Looks:** ready-made icon and colour pairs: Note, Info, Tip, Warning, Danger and Quote, plus your own saved styles.
- **Colour:** the theme's accent, nine colours, or any colour from the picker.
- **Style:** Soft (a light fill), Outline, Bar (a stripe on the left) or Solid. On a solid callout, the text turns black or white, whichever reads better.
- **Save as a style:** names the current look so you can use it on other callouts. Saved styles are kept on this device. Each callout stores its own colour and style, so it looks the same everywhere.

**In the page schema:** the callout's attributes are `icon`, `color` ('' or a hex colour) and `variant` (`soft`, `outline`, `bar` or `solid`).
