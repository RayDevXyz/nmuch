# Writing a module

A module adds **logic**: it reads folders, builds databases and keeps them up to date. Like a
widget, it is **one HTML file**. The difference is what it may touch:

| | Widget ([widgets.md](widgets.md)) | Module |
|---|---|---|
| Purpose | Shows and edits data that already exists | Does work: reads files, creates and fills databases |
| Access | The databases and columns you bind to one block | The **capabilities** you approve once for the module |
| Files on disk | Never | Folders you choose for it |

A complete example is [`examples/folder-index.html`](examples/folder-index.html). It lists a
folder you choose, keeps the list live as files change, opens files, and saves the list as a
database.

---

## 1. The manifest

The manifest is JSON inside `<script type="application/bw-module+json">`:

```html
<script type="application/bw-module+json">
{
  "id": "me.media-shelf",
  "name": "Media shelf",
  "description": "Catalogs the videos in folders you choose.",
  "version": "1",
  "icon": "🎞️",
  "namespace": "shelf",
  "capabilities": ["fs.pick", "fs.open", "db.own"]
}
</script>
```

| Key | Meaning |
|---|---|
| `id` | Unique, 2–64 chars of `a-z 0-9 . - _`. Use a prefix of your own. |
| `namespace` | The prefix of the page properties the module owns (`shelf.*`). It must be a short lowercase word, and `db`, `module` and `page` are taken. |
| `capabilities` | What it needs. The user sees each one in plain words and approves them together. |

### Capabilities

| Capability | Allows | The user sees |
|---|---|---|
| `db.own` | Create databases. Read and change **the databases it created**. | "Create its own databases and change them" |
| `db.read` | Read **any** database | "Read all your databases" |
| `db.write` | Change rows in **any** database | "Change rows in any of your databases" |
| `fs.pick` | Ask the user to choose folders. Each chosen folder becomes readable. | "Ask you to choose folders it may read" |
| `fs.read:<path>` | Read a fixed folder (`~` is the home folder) | "Read files in ~/Videos" |
| `fs.open` | Open files it can read in their default app | "Open files it can read in their default app" |

**Ask for as little as you can.** Prefer `fs.pick` over `fs.read:~`, and `db.own` over
`db.read`.

**An update that asks for more needs approval again.** Until then the module can do nothing.

Every module may always read and set **page props in its own namespace** (`shelf.*`) on any
page. That's how a module marks "this page is a movie, from this file" without a database.

---

## 2. What is enforced, and where

The Rust core checks every call (`crates/bw-core/src/modules.rs`):

- **Approval comes first.** Until the user approves the module, every call is refused.
- **Folders: the real path must be inside a folder the module was given.**
  - The path is resolved first, so `..` and symbolic links can't climb out of the folder.
  - One module's folders are never another module's.
  - Hidden files and folders (`.git`, `.DS_Store`, …) are not listed.
- **Databases:** with `db.own`, only databases whose page carries `module.owner = <your id>`.
  The core sets that when the module creates the database. A database id the module may not
  use (or that doesn't exist) gets the same "not allowed", so the module can't probe which ids
  exist.
- **Props:** only keys that start with `<namespace>.`.

The browser adds a second wall, the same sandbox widgets use:
- `sandbox="allow-scripts"` and no `allow-same-origin`, so no access to the app, its storage or
  Tauri.
- A Content-Security-Policy with no network access.

The host attaches the module's id to every call from the module it started, so a module can't
pretend to be another one. The Course module has no sandboxed code, so its id is refused here
outright.

**Users stay in control.** **Settings → Modules** shows, for every module, what it may do and
which folders it has. From there the user can:
- take away a single folder;
- **Revoke** everything (the module stays installed but can't do anything);
- **Uninstall** it. Pages and databases it created stay.

---

## 3. The `bw` API

```js
await bw.ready
bw.module    // { id, name, namespace }
bw.pageId    // the page the module's block is in
bw.settings  // this block's own options; bw.setSettings({...}) and bw.onSettings(cb)
bw.editable  // false on read-only pages (changes are refused)
```

### Files

```js
const folder = await bw.fs.pickFolder('Choose your videos')  // null if cancelled; needs fs.pick
await bw.fs.roots()                       // folders it may read
await bw.fs.list(folder, { recursive: true, max: 2000 })
//  [{ path, rel, name, isDir, size, modified }]   rel is relative to `folder`, with / separators
await bw.fs.readText(path, { max: 1 << 20 })   // up to 1 MB by default
await bw.fs.open(path)                    // needs fs.open: opens it in its app
bw.fs.onChange((root) => refresh())       // files changed in one of its folders
```

The app watches every folder a module has. It waits for changes to settle (copying a large
file fires many events), then tells the module.

### Databases

```js
const db = await bw.db.create({ title: 'Movies', icon: '🎞️' })   // under bw.pageId; needs db.own
await bw.db.setProperty(db, { id: 'year', name: 'Year', type: 'number' })
const row = await bw.db.createRow(db, 'Alien', { year: 1979 })
await bw.db.setValue(row, 'year', 1979)
const r = await bw.db.query(db, { filters: [], sorts: [{ property: 'year', desc: true }] })
const stop = bw.db.subscribe(db, view, (r, error) => render(r))   // live, like widgets
```

Query results have the same shape as the app's database views:
- `properties`
- `rows` (`{ id, title, values }`)
- `related`
- `total`

### Props and pages

```js
await bw.props.set({ 'shelf.file': '/videos/alien.mkv' }, rowId)   // default: bw.pageId
await bw.props.get(rowId)        // its own namespace only
bw.openPage(id)                  // navigate the app to a page
```

---

## 4. Installing and using

1. **Settings (⚙) → Modules… → Install from file…** The module shows **Needs approval** and
   lists what it asks for.
2. **Approve** it, there or in its block.
3. Type `/` and its name in a page to place it. Its block is its user interface. The page it sits
   in is where it keeps its databases and settings.

---

## 5. First-party modules

Modules that ship with the app, like **Courses** and **PARA**, are Rust in `bw-core` (see `course.rs`, `para.rs`).
- **The same checks apply.** The Course module creates its databases through
  `module_create_database`, reads folders through `fs_list`, and opens files through
  `fs_open_check`.
- **They're trusted with the app, not more.** Their capabilities are approved when the app
  installs them; the user still chooses their folders.
