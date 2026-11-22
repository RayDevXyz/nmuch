# Formulas: live values in your text

A formula shows a value in a sentence that keeps itself up to date. The value can be a page property, a database cell, a count or total over a database, or some logic on top of those.

**Making one:**
- type `{{= … }}`. It turns into a formula when you type the closing `}}`.
- or use `/formula`, which opens the formula editor.

Click a formula to edit it. The editor shows the result as you type, plus examples you can click to use. Enter saves.

**How a value shows:**
- numbers: 1,141
- yes or no: ✓ / ✗
- empty: —
- an error: ⚠ (hover over it for the reason)

## What you can write

| Write | Gives |
|---|---|
| `Status` | this page's property (or its cell, if the page is a database row) |
| `prop("Due date")` | the same, for a name with spaces |
| `title`, `created`, `updated` | this page's title and dates |
| `[[Dune]].Rating` | another page's property or cell |
| `[[Books]].count` | how many rows a database has |
| `[[Books]].count(Read = true)` | how many rows match |
| `[[Books]].sum(Pages)`, `.avg(Rating)`, `.min(…)`, `.max(…)` | totals over the rows |
| `[[Books]].where(Genre = "Sci-fi")` | only the rows that match (then `.count`, `.list(title)` …) |
| `[[Books]].list(title)`, `.first(title)`, `.sort(Pages)`, `.sortDesc(Pages)` | lists and order |
| `if(Pages > 300, "long", "short")` | logic |
| `and`, `or`, `not`, `=`, `!=`, `<`, `>`, `<=`, `>=` | comparisons |
| `+ - * / %` | maths; `+` or `&` also joins text |
| `round(x, 1)`, `floor`, `ceil`, `abs`, `min(a, b)`, `max(a, b)` | numbers |
| `len`, `upper`, `lower`, `contains(Tags, "books")`, `empty(x)`, `join(list, ", ")` | text and lists |
| `today()`, `now()`, `days(from, to)`, `date(x, "D MMM YYYY")` | dates; a date plus a number gives a later date |

**Inside a row method** such as `count(…)`, `sum(…)` or `where(…)`, a bare name means that row's column. `count(Read = true)` counts rows whose Read box is ticked.

**Values a formula sees:** select options as their names, relations as the titles of the linked rows, dates as `YYYY-MM-DD`.

**Matching:** property and column names ignore capitals. A `[[Title]]` matches a page's exact title, ignoring capitals.

**When values refresh:** after changes anywhere in the workspace, within a moment. That includes changes from another window or a synced computer.

## Under the hood

- **Storage:** the node is `formula` (inline), and its `expr` attribute holds the text. The core keeps it but doesn't evaluate it. Markdown export writes `{{= … }}`.
- **Language:** `apps/desktop/src/formulas/lang.ts`.
- **Data:** `data.ts` reads page properties and database cells, with a cache that's cleared on every core event.
- **Templates:** they leave `{{= … }}` alone, so a template can contain formulas.

See also: [databases](databases.md) and [page properties](page-properties.md), where the values come from.
