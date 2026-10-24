# Nimbus

A local-first, block-based notes app built from the Nimbus v0 design template.
Tauri v2 + Rust + SQLite on the desktop, React 19 + TypeScript + Vite in the UI.
No account and no cloud: everything is stored in one SQLite file on your machine.

## Run it (Windows)

Prerequisites: Node 20+, Rust (via rustup), and the Microsoft C++ Build Tools (the usual Tauri setup).
WebView2 already ships with Windows 10/11.

```bash
npm install
npm run tauri dev      # desktop app with SQLite
npm run tauri build    # installer → src-tauri/target/release/bundle/
```

`npm run dev` also works on its own and opens the UI in a browser. In that case notes go to IndexedDB instead of SQLite, which is handy for UI work.

Database location: `%APPDATA%\app.nimbus.notes\nimbus.db`. Settings → *Storage* shows the full path.

`npm run build` runs only `vite build`. Run `npm run typecheck` on its own for a strict `tsc` pass.

## What's in it

**Editor (blocks)**
- Block types: text, heading 1–3, bulleted, numbered, to-do, quote, callout, code, divider, image, sub-page
- `/` slash menu, `[[` page links with "create page", and Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, `!>`, ```` ``` ````, `---`)
- Enter splits a block, Backspace merges, arrow keys move between blocks and keep the caret column, Tab and Shift+Tab indent
- Drag blocks by the handle. Click the handle for *Turn into*, duplicate, move, or delete
- Select blocks with Esc, Shift+↑/↓, or by dragging a box in the margin. Selected blocks can be deleted, copied or cut as Markdown, indented, or duplicated
- Inline toolbar on text selection: bold, italic, underline, strike, inline code, link
- Paste Markdown and it becomes blocks. Paste or drop images and they're stored inline (large photos are downscaled to max 2000px)
- Page-level undo and redo (Ctrl+Z / Ctrl+Shift+Z)
- `#tags` anywhere in text are indexed

**Workspace**
- Nested page tree with drag-to-reorder or nest, inline rename, and a context menu
- Tabs: click replaces the current tab, Ctrl+click or middle-click opens a new one
- Views: Documents, Recent, Favorites, Tags, Archive, Trash (restore or delete forever)
- Outline of the current page with scroll tracking. Breadcrumbs
- Graph view (local or all) with d3-force, backlinks with snippets, and unlinked mentions
- Quick find (Ctrl+K) across titles and content
- Copy a page as Markdown
- Dark and light themes, normal or wide page, three text sizes, spellcheck toggle

Press **Ctrl+/** in the app for the full shortcut list.

## Architecture

```
src/
  lib/storage/      Storage interface; tauri.ts (Rust commands) and browser.ts (IndexedDB)
  lib/fractional.ts fractional-index sort keys for pages and blocks
  lib/html.ts       inline-HTML sanitizer, plain text, links/tags, Markdown in/out
  lib/caret.ts      caret and selection helpers for per-block contentEditable
  state/            tiny external store (useSyncExternalStore) and actions
  editor/           Editor, BlockView, slash menu, inline toolbar
  components/       shell from the template: top bar, rail, sidebar, tabs, right panel
src-tauri/src/db.rs SQLite schema and queries (rusqlite, bundled)
```

- Each block is a row (`blocks`) with a fractional `sort_key`, so moving or inserting a block writes only that block
- Saves are incremental: dirty and deleted block IDs are debounced (400 ms) and written in one transaction
- `links` and `tags` are derived tables, rewritten per block on save. They power backlinks, the graph, and Tags
- Block text is a small inline-HTML subset (`b i u s code a br`), sanitized before every write
