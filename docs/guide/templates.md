# Templates

A template is an ordinary page inside the page **Templates**. Its sub-pages are part of the template too.

Templates have their own place in the left rail: **Templates** (the stacked-pages icon). That keeps them out of the Documents tree. There you can:
- see your templates and their sub-pages, and open one to edit it;
- make a new one with **+**;
- start **New page from a template**.

On a phone, Templates is one of the chips in the page drawer. Write it with the full editor: text, tables, databases, a header, properties, maps of content. Wherever the text should change from one use to the next, put a variable in `{{…}}`.

## Variables

| Write | You get |
|---|---|
| `{{Client}}` | a field in the form; the answer goes everywhere `{{Client}}` appears |
| `{{Due: date}}` | a field with a date picker (YYYY-MM-DD) |
| `{{Hours: number}}` | a number field |
| `{{Status: Todo \| Doing \| Done}}` | a choice |
| `{{Author = Ray}}` | a field with a default value; types and choices can have one too: `{{Status: Todo \| Done = Todo}}` |
| `{{title}}` | the new page's title |
| `{{date}}` / `{{time}}` / `{{now}}` | today (2026-11-22) / the time (09:05) / both |
| `{{date:dddd D MMMM YYYY}}` | a date in your format: `YYYY YY MMMM MMM MM M DD D dddd ddd HH mm WW`, with `[text]` kept as is |
| `{{date+7}}`, `{{date-1:DD/MM}}`, `{{tomorrow}}`, `{{yesterday}}` | days from today |
| `{{weekday}}`, `{{week}}` | Monday…, the ISO week number |
| `{{parent}}` | the title of the page the new page is made under (for a sub-page: its parent's new title) |
| `\{{Client}}` | the braces as typed |

**How variables are handled:**
- **Same name:** a variable is asked once, however often it appears, including in sub-pages. Capitals don't matter.
- **Type and default:** the first mention that gives a type or a default sets them.
- **Where they work:** in titles, text, links, image captions, header text, page properties, database rows and the settings of a map of content. A map with the tag `{{Client}}` lists that client's pages.
- **Built-in names:** don't name your own fields after the built-in ones (`title`, `date` and so on).

**The template's title is the new page's title**, filled in. A template called `Meeting {{date:D MMM}}` makes "Meeting 22 Nov". You can change the title in the form.

## Using a template

- **New page from template…**: in the top bar's ⋯ menu, or with **Ctrl Shift N**. The form asks for the title and each field. The new page and its sub-pages are created and the new page opens.
- **Add sub-page from template…**: in a page's ⋯ menu. The same form; the new page goes under the current one.
- **`/template`** in a page, or `/` followed by the template's name. You choose:
  - **As a sub-page:** a new page, linked where the cursor is.
  - **Insert here:** the template's content goes into this page, and its sub-pages are made under this page.
- **The syntax:** type a line like this and press **Enter**:

  ```
  {{template: Meeting | title: Weekly sync | Client: Acme | Due: 2026-12-01}}
  ```

  The page is made as a sub-page, and the line becomes a link to it.
  - If a field has no value and no default, the form opens with what you gave filled in.
  - The name matches the template's title, ignoring capitals and its `{{…}}` parts.

**Save as template**, in a page's ⋯ menu, copies a page and its sub-pages into Templates as they are.

**Databases in a template:**
- The columns and views are copied, and so are rows with their values.
- Relation and rollup columns point at other databases, so they aren't copied.

Code: `apps/desktop/src/templates/`. `engine.ts` holds the syntax, `apply.ts` reads and creates the page trees, and `TemplateDialog.tsx` is the form. The `{{template: …}}` line is handled by `packages/editor/src/nodes/template-call.ts`, through `EditorHost.templateCall`.
