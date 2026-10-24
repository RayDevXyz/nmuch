# BrainWaves Core Architecture

Oct 24, 2026 · @ray

The Y.js update log is the source of truth, a Rust core is its only writer, and everything else — the SQL index, the editor views, widgets, modules and published output — is a projection of it or a client of the core.

## Core system layout

The Rust core is the only writer to storage; the React frontend, the block engine, widgets and modules all reach data through it.

&#91;embedded content: BrainWaves core layout · frontend, Rust core, storage\]

**Rust core (Tauri)**

- Uses **yrs**, the Rust port of Y.js, so the core can apply and read updates itself, not just store bytes. Indexing, automation and export run in Rust even when no editor is open.
- SQLite holds the Y.js update log (the truth) plus projected tables: `blocks`, `refs`, `props`, `db_rows`. The projected tables are rebuildable.
- Also contains the indexer, query engine, capability host (file system primitives), event bus and exporter.

**Frontend (Vite, React, shadcn)**

- App shell, sidebar, settings and module UIs.
- The block engine is its own package behind an interface: schema, renderers, commands.

**Block engine: copy BlockSuite's model, not the library**

- BlockSuite (AFFiNE) is a strong reference: one Y.Doc per page, blocks as Y.Maps, and page and edgeless as two views over the same block tree.
- It is built on Lit web components, is heavy, and its API follows AFFiNE's needs, so adopting it directly couples BrainWaves to it.
- Define your own block schema in a shared package. Doc mode: ProseMirror/Tiptap with y-prosemirror, or a custom React block renderer. Edgeless mode: the same blocks plus an `xywh` property, rendered on a canvas (tldraw-style).
- Because the schema is the contract, renderers can be swapped later without migrating data.

## Live databases and widgets

Live tables and widgets that exchange data work cleanly if every write goes through the same core transaction path; then "live" comes for free.

- **Rows are blocks.** A database is a block with a schema. Rows are pages or blocks whose `parent` is that database. Views (table, kanban, gallery) are saved query specs. This is Notion's model and matches the Course module, where a course is a page with properties.
- **Widget API is reactive.** `db.subscribe(query, cb)` and `db.mutate(rowId, patch)`. A mutation flows widget → core → yrs update → index → event bus → every subscriber. If widget A writes table X, widget B, which reads X, updates instantly with no direct wiring between them.
- **Cross-table data flows** in two layers:
  - Declarative: relations, rollups and formulas, which cover most cases.
  - Imperative: automations that live in the core ("when a row is added in X, create a row in Y"). They run even when no widget is mounted.
- **Watch performance.** Don't put a 10,000-row table into one Y.Doc. Give each row its own small doc or block, and let SQLite do the querying.
- **Widgets declare access.** Each widget lists which tables it reads and writes, checked by the same capability host as modules.

## Module contract

Modules hold logic, not data: they read and write through the database and reach the system only through primitives the Rust core exposes.

- **Manifest declares capabilities**, approved once by the user. For example `fs.write: ["~/Courses/**"]`, `db.read: ["course.*"]`, `db.write: [...]`.
- **System code runs in Rust, exposed as primitives.** The core offers a fixed set: create folder, move, copy, hash, watch, read metadata. A module's frontend logic calls these through the core, which checks capabilities. Modules never get raw native access.
- **First-party vs third-party.** Your own modules (Course, Media Organizer) can ship Rust code compiled into the app. Third-party modules get only the primitives. This one rule removes most of the security risk.
- **File operations are logged and undoable**, like the media organizer's `dupes/` folder. Automation that moves files needs an undo trail.
- **Each module owns a property namespace** (`course.progress`, `course.source_path`) stored on ordinary blocks, so "a course is just a page with extra properties" stays true.
- **Page Modules run the automation.** A module is a set of logic; the page it is attached to supplies the data and triggers file and data automation through the core.

## Local publish

Publish is another projection of the Y.js log, like the SQL index: disposable and regenerated on demand.

- **Markdown mirror.** One folder per notebook, one `.md` per page, with frontmatter holding the block ID and properties. File names are deterministic (slug + short ID) and output is written in a stable order, so diffs stay clean.
- **Git on top.** Auto-commit the export folder on a timer or on demand. This gives GitHub-style history and diffs, and the repo can be pushed to GitHub.
- **Static site.** The same projection rendered to HTML is a local "Publish".
- **One-way first.** Round-trip import from edited Markdown means matching blocks back by ID; add it later only if needed.

## Build order

Start with the spike that proves the storage model; each later phase builds on the transaction path it establishes.

1. Block model + yrs persistence + index rebuild (the spike)
2. Doc-mode editor
3. Database block + views
4. Widget data API
5. Edgeless mode
6. Module capability host + Course module
7. Markdown/git export
