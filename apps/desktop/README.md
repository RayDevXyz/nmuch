# Nimbus

A local-first, block-based notes app built from the Nimbus v0 design template.
Tauri v2 + Rust + SQLite on the desktop, React 19 + TypeScript + Vite in the UI.
No account and no cloud: everything is stored in one SQLite file on your machine.

## Run it

Nimbus is the app shell of BrainWaves. Its data lives in the BrainWaves Rust core (`crates/bw-core`):
every edit is a Yjs update in a SQLite log, and the search/backlink/tag index is rebuilt from it.
See `docs/phase-02-editor.md` at the repository root.

Prerequisites: Node 20+, pnpm, Rust (via rustup), and the usual Tauri setup
(Microsoft C++ Build Tools on Windows; WebView2 ships with Windows 10/11).

```bash
pnpm install               # at the repository root
pnpm tauri dev             # in apps/desktop: desktop app
pnpm tauri build           # installer -> src-tauri/target/release/bundle/
```

In a browser, against the same Rust core (two terminals, in `apps/desktop`):

```bash
pnpm core                  # bw-devserver on 127.0.0.1:1430, data in brainwaves-dev.db at the repo root
pnpm dev                   # Vite on http://localhost:1420 (proxies /api to the dev server)
```

Database location: `%APPDATA%\app.nimbus.notes\brainwaves.db` (an older `nimbus.db` there is not touched).
Settings → *Storage* shows the full path.

## What's in it

**Editor (blocks)**
- Block types: text, heading 1–3, bulleted, numbered, to-do, quote, callout, code, divider, image, sub-page
- `/` slash menu, `[[` page links with "create page", and Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, `!>`, ```` ``` ````, `---`)
- A Tiptap editor per note (`packages/editor`): selection, copy/paste and undo work across blocks; Tab and Shift+Tab nest list items
- `((` links a single block; refs always show the target's current title
- Drag blocks by the handle. Click the handle for *Turn into*, duplicate, or delete
- Inline toolbar on text selection: bold, italic, underline, strike, inline code, link
- Paste Markdown and it becomes blocks. Paste or drop images and they're stored inline (large photos are downscaled to max 2000px)
- Undo and redo per note (Ctrl+Z / Ctrl+Shift+Z), from Yjs
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
  lib/core/client.ts     connection to the Rust core (Tauri command/event, or dev server HTTP/SSE)
  lib/core/page-sync.ts  one Y.Doc per open page, kept in sync with the core
  lib/storage/           page metadata + index queries (backlinks, mentions, graph, tags, search)
  lib/convert.ts         Nimbus-style blocks / Markdown -> Tiptap content (seed, paste)
  lib/fractional.ts      fractional-index sort keys for pages
  state/                 tiny external store (useSyncExternalStore) and actions
  editor/Editor.tsx      page chrome (icon, title) + one NoteEditor per note
  components/            shell: top bar, rail, sidebar, tabs, right panel
src-tauri/src/lib.rs     opens bw-core; one command `core_call` + `core-event` stream
```
