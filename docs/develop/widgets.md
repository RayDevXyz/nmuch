# Writing a widget

A widget is **one HTML file**. You put it in a page with `/` and connect it to your databases.
It runs in a sandbox and can only reach the databases and columns that you connected.

This guide covers everything you need to write your own. The four built-in widgets in
`apps/desktop/src/widgets/builtin/` are complete examples:
- `progress.html`
- `quick-add.html`
- `chart.html`
- `course-dashboard.html`

---

## 1. The smallest widget

```html
<!doctype html>
<html>
<head>
<script type="application/bw-widget+json">
{
  "id": "me.open-tasks",
  "name": "Open tasks",
  "description": "How many tasks are still open.",
  "version": "1",
  "icon": "✅",
  "slots": {
    "tasks": {
      "access": "read",
      "label": "Tasks",
      "fields": {
        "done": { "label": "Done", "types": ["checkbox"] }
      }
    }
  }
}
</script>
</head>
<body>
  <div id="out">…</div>
  <script>
    bw.ready.then(() =>
      bw.subscribe('tasks', { filters: [{ property: 'done', op: 'is', value: false }] }, (r, error) => {
        document.getElementById('out').textContent = error ?? `${r.total} open in ${r.database.title}`
      }),
    )
  </script>
</body>
</html>
```

To install it, go to **Settings (⚙) → Widgets… → Install from file…** and pick the file. Then:
1. Type `/open tasks` in any page.
2. Choose a database for "Tasks".
3. Check that "Done" points to the right checkbox column.
4. Click **Connect**.

Installing a file with the same `id` again replaces the old version.

---

## 2. The manifest: what the widget asks for

The manifest is the JSON inside `<script type="application/bw-widget+json">`.

| Key | Meaning |
|---|---|
| `id` | Unique, 2–64 chars of `a-z 0-9 . - _`. Use a prefix of your own (`me.…`). `brainwaves.…` is taken by the built-ins. |
| `name`, `description`, `icon` | Shown in the `/` menu and the widgets manager. `icon` is an emoji. |
| `version` | Free text. |
| `height` | Starting height in pixels. The widget then sizes itself to its content. |
| `slots` | The databases the widget works with (see below). |

A **slot** is one database the widget needs. The user picks which database fills it.

| Key | Meaning |
|---|---|
| `access` | `"read"` or `"write"`. Only write slots can add or change rows. |
| `label`, `description` | Shown on the setup screen. |
| `fields` | The columns the widget needs, by **your own key**. |

A **field** is `{ "label", "types": [...], "optional": false }`. `types` lists the column types
that will do:
- `text`, `number`, `select`, `multiSelect`, `date`, `checkbox`
- `url`, `file`, `relation`, `rollup`

On the setup screen the user can only choose columns of those types. A column whose name matches
the field's key or label is picked automatically.

Every slot also gives the widget the row **title**, without being asked.

---

## 3. What the widget can and can't do

What the widget sees is exactly what the user connected:
- **Databases:** the one bound to each slot, no others.
- **Columns:** the title plus the bound fields. Values arrive under **your field keys**. The
  widget never sees column ids or the names of other columns.
- **Writes:** only through `write` slots, and only to rows of that slot's database.

These rules are checked in the Rust core on **every call**. The core reads the bindings from the
page itself, not from anything the widget sends. A widget can't widen them by asking differently.

The sandbox also takes away the web platform's ways out:

| | |
|---|---|
| Network (`fetch`, images from URLs, …) | Blocked by the page's Content-Security-Policy. |
| The app, its storage, Tauri | Blocked: `sandbox="allow-scripts"` gives the frame an opaque origin. |
| `localStorage`, cookies | Not available. Keep state in settings (below) or in a database. |
| `<form>` submission, popups, top navigation | Not allowed. Handle Enter and clicks yourself. |
| Images, fonts, media | Inline `data:` or `blob:` URLs only. |

---

## 4. The `bw` API

`bw` is a global. It exists before your scripts run.

```js
await bw.ready            // resolves once slots, settings and theme have arrived
bw.slots                  // { tasks: { access: 'read', fields: ['done'] } }
bw.settings               // this instance's own options (see setSettings)
bw.editable               // false on read-only pages: writes will be refused
```

### Reading

```js
const r = await bw.query('tasks', {
  filters: [{ property: 'done', op: 'is', value: false }], // property = a field key, or 'title'
  sorts:   [{ property: 'title', desc: false }],
  limit:   20,
})

const stop = bw.subscribe('tasks', query, (r, error) => render(r)) // live; call stop() to end
```

`subscribe` calls back immediately. It calls back again whenever anything changes, wherever the
change came from:
- another widget;
- a database table;
- another window.

Prefer it over `query` for anything you display.

The filter ops are `is`, `isNot`, `contains`, `notContains`, `gt`, `lt`, `empty` and `notEmpty`.

The result `r` looks like this:

```js
{
  database: { id, title, icon },
  fields: [{ key: 'done', name: 'Done', type: 'checkbox', options: [] }], // includes 'title'
  rows: [{ id, title, icon, values: { done: true } }],                   // only bound fields
  related: { [rowId]: { id, title, icon } },  // titles of rows that relation fields point at
  total: 12,                                  // matches before `limit`
}
```

Value shapes by column type:

| Column type | Value |
|---|---|
| checkbox | `true` / `false` |
| number | a number |
| text, url, file | a string |
| select | an option id (look it up in `fields[].options` for its `name` and `color`) |
| multiSelect | an array of option ids |
| relation | an array of row ids (titles are in `related`) |
| date | a date string, e.g. `2026-10-29` |
| percent-checked rollup | a fraction from 0 to 1 |

### Writing (write slots only)

```js
const id = await bw.createRow('tasks', { title: 'Buy milk', done: false })
await bw.mutate('tasks', rowId, { done: true, title: 'Renamed' })
```

A refused call rejects with an `Error` whose message says why. For example:
- `slot "tasks" is read-only`
- `"priority" is not a field of slot "tasks"`

### Everything else

```js
bw.openRow(rowId)           // open a row as a page (only rows the widget has been shown)
await bw.setSettings({ label: 'Done this week' })
bw.onSettings((s) => …)     // settings changed (here or in another window)
```

**Settings** are stored on the widget's block in the page:
- They're per instance, synced, and part of the page's history.
- They're for the widget's own options (a label, a chosen mode), up to 64 KB.

---

## 5. Looking at home in the app

The app passes its colors and font in as CSS variables, and updates them when the user switches
between light and dark:

```
--bw-fg  --bw-muted  --bw-faint  --bw-accent  --bw-accent-soft  --bw-accent-ink
--bw-panel  --bw-panel-2  --bw-line  --bw-ok  --bw-danger  --bw-font
```

The page background is transparent, and `body` already uses `--bw-font` and `--bw-fg`.

---

## 6. Tips

- **Render from `subscribe`**, not from your own writes. After `createRow` or `mutate`, the
  subscription calls back with the new data anyway.
- **Escape titles and values** before using them in `innerHTML`. Row titles are user text.
- **Mark fields `optional`** when the widget can work without them. The progress widget's "Group
  by" is optional, for example.
- **Keep it to one file.** Inline your CSS and JS. Up to 2 MB is accepted.
