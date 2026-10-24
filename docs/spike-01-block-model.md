# Spike 1: Block model, yrs persistence and index rebuild

> **Update (phase 2):** the write path, the update log, the rebuildable index, compaction and
> the event bus described here are unchanged. Two things moved on:
> - **The block layout.** Section 4: blocks are now ProseMirror nodes inside one
>   `Y.XmlFragment` per note, so the Tiptap editor and the core read the same structure.
> - **The index tables.** Section 6: they gained `page_meta` and `tags`.
>
> The demo example was replaced by `examples/contract_fixture.rs`. See
> [phase-02-editor.md](phase-02-editor.md) for the current layout.

**Status:** done. 12 of 12 acceptance tests pass.
**Code:** `crates/bw-core/`.
**Branch:** `claude/dazzling-einstein-0r1sxx`.
**Plan:** step 1 of the build order in `BrainWaves Core Architecture.md`.

---

## 1. What this spike had to prove

The architecture doc makes one bet that everything else depends on:

> The Y.js update log is the source of truth, a Rust core is its only writer, and everything
> else is a projection of it or a client of the core.

If the bet is wrong, every later phase (editor, databases, widgets, export) is built on sand.
So before writing any UI, the spike checks these claims with running code:

| # | Claim | Proven by test |
|---|-------|----------------|
| 1 | A block tree (pages, nesting, properties, text) fits cleanly into one Y.Doc per page | `block_tree_round_trips_through_snapshot` |
| 2 | Every write is stored as a yrs update in SQLite, and the SQL index is updated **in the same transaction** | `every_write_is_logged_and_indexed_atomically` |
| 3 | Edits, moves, deletes and property changes all reach the index | `edits_moves_and_deletes_are_reflected` |
| 4 | A write that fails halfway leaves no trace | `failed_transaction_persists_nothing` |
| 5 | Closing and reopening the app restores the same documents | `persistence_survives_reopen` |
| 6 | **The index is disposable.** Rebuilding it from the log gives exactly the index that live writes built | `rebuilt_index_equals_incremental_index` |
| 7 | If the index tables are lost, the core rebuilds them on startup | `deleted_index_is_rebuilt_on_open` |
| 8 | The log can be compacted without changing any document | `compaction_keeps_the_document_identical` |
| 9 | An editor with its own Y.Doc can sync through the core, and the core is still the only thing that writes to disk | `editor_updates_flow_through_the_core` |
| 10 | Concurrent offline edits merge, whatever order they arrive in | `concurrent_offline_edits_converge` |
| 11 | Subscribers hear about every commit | `event_bus_reports_commits` |
| 12 | Corrupt input is rejected before anything is written | `bad_updates_are_rejected_without_writing` |

---

## 2. The big picture in one diagram

```text
             ┌─────────────────────────────────────────────────────────────┐
  editor  ──►│  Core::apply_update(bytes)                                  │
  (its own   │                                                             │
   Y.Doc)    │   1. apply to in-memory Y.Doc (yrs)                         │
             │   2. take the update bytes (what changed)                   │
  module /   │   3. ONE SQLite transaction:                                │
  widget  ──►│        a. INSERT INTO updates  (the truth)                  │
             │        b. re-project the page into blocks/props/refs/db_rows│
  Core::     │   4. emit Event on the bus                                  │
  transact() │                                                             │
             └─────────────────────────────────────────────────────────────┘
                                │                         │
                    ┌───────────▼──────────┐   ┌──────────▼───────────┐
                    │  TRUTH (never lost)  │   │  INDEX (disposable)  │
                    │  pages               │   │  blocks   props      │
                    │  updates (log)       │──►│  refs     db_rows    │
                    └──────────────────────┘   │  index_state         │
                         rebuild_index() ──────┘                      │
                                               └──────────────────────┘
```

Remember one rule: **the left box is the data, the right box is a cache.**
You could delete the right box at any time and lose nothing.

---

## 3. Key ideas, explained simply

### 3.1 What is a Y.Doc, and why yrs?

A **Y.Doc** is a CRDT document: a data structure that several copies can edit independently,
offline, and that always merges to the same result. Every change it makes can be exported
as a compact binary **update**. Applying the same set of updates in any order gives the same
document.

**yrs** is the Rust port of Y.js, and its binary format is the same. So:

- The frontend editor (Y.js plus y-prosemirror) and the Rust core can exchange updates directly.
- The core can **read** documents itself instead of just storing opaque bytes. That is what
  makes indexing, automation and export possible in Rust while no editor is open.

### 3.2 Why "a log of updates" instead of "save the document"?

We never overwrite a document. We **append** each change to a log (the `updates` table).
To load a page, we replay its log into a fresh Y.Doc.

This gives us:
- **Safety:** an append can't corrupt older data.
- **Sync for free:** the log is already in the format other replicas use.
- **History:** the log is a record of what happened. Compaction can trade this away when needed.

### 3.3 What is a "projection"?

A Y.Doc is great for editing but bad for questions like *"which blocks link to X?"* or
*"all lessons with progress < 1"*. So after every write we **project** the page into ordinary
SQL tables that are easy to query. The projection is a pure function of the log:

```
index = project(replay(log))
```

Because it is a pure function, it can always be recomputed. That is why it is *disposable*.

---

## 4. The block model (the contract)

File: `crates/bw-core/src/schema.rs`

Each **page is one Y.Doc**. The page's id is also the id of its root block. Inside the doc:

```text
Y.Doc  (page_id == id of the root block)
├── "meta":   Y.Map { "root": <page_id>, "schema": 1 }
└── "blocks": Y.Map<block_id → Y.Map {
        "id":       String
        "flavour":  String              "page" | "paragraph" | "heading" | "todo" | "code" | "database" | …
        "parent":   String | Null       Null only for the root
        "children": Y.Array<String>     ordered child ids
        "props":    Y.Map<String, Any>  namespaced keys: "course.progress", "course.source_path"
        "text":     Y.Text              the block's text (for a page: its title)
    }>
```

Design choices, and why each one was made:

| Choice | Why |
|---|---|
| Blocks stored **flat** in one map, linked by id | Moving a block only changes two `children` arrays, not a nested structure. This is BlockSuite's model too. |
| Order lives in the parent's `children` Y.Array | Y.Array merges concurrent inserts in a well-defined order, so two people adding blocks at the same time both keep their blocks. |
| `parent` back-pointer | Fast "who is my parent", which `move` and `delete` need. |
| Every block has a `Y.Text` | Collaborative character-level text editing. y-prosemirror can bind to it later. |
| `flavour` is a **string**, not an enum | Modules can add their own block types without changing the core. |
| `props` keys are **namespaced** (`course.progress`) | The architecture doc's "each module owns a property namespace". A course is just a page with `course.*` props. |
| A database is a block with `flavour = "database"`, and **its children are its rows** | The architecture doc's "rows are blocks" (Notion's model). No separate row storage. |
| `meta.schema = 1` | Lets future versions migrate old docs. |

### 4.1 Editing blocks: `BlockTxn`

File: `crates/bw-core/src/doc.rs`

All edits happen inside a closure that receives a `BlockTxn`:

```rust
core.transact(&page, |tx| {
    let h  = tx.append(&page, flavour::HEADING, "Week 1")?;
    let db = tx.append(&page, flavour::DATABASE, "Lessons")?;
    let r1 = tx.append(&db,   flavour::PAGE, "Lesson 1")?;   // a row
    tx.set_prop(&r1, "course.progress", json!(0.5))?;
    tx.move_block(&h, &db, Some(0))?;
    tx.insert_text(&h, 4, "!")?;
    Ok(())
})?;
```

Available operations: `insert_block`, `append`, `set_text`, `insert_text`, `set_flavour`,
`set_prop`, `remove_prop`, `move_block`, `delete_block` (deletes the whole subtree), `exists`.

Guard rails: you can't move a block inside its own subtree, delete or move the page root, or
use an index out of range. Unknown ids return `Error::BlockNotFound`.

**Everything inside one closure becomes one yrs update, which is one row in the log.**

### 4.2 Reading blocks: `snapshot`

`snapshot(doc, page_id)` walks the tree depth-first from the root and returns a
`PageSnapshot`: a `Vec<BlockSnapshot>` in document order. Each entry holds id, parent,
flavour, position, depth, text and props as JSON. It is plain data with no yrs types, so the
indexer, exporter and tests can use it without knowing anything about CRDTs.

---

## 5. Persistence: the truth tables

File: `crates/bw-core/src/store.rs`

```sql
CREATE TABLE pages (
    page_id    TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);
CREATE TABLE updates (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- global order
    page_id    TEXT NOT NULL REFERENCES pages(page_id),
    data       BLOB NOT NULL,                       -- yrs update, lib0 v1 encoding
    created_at INTEGER NOT NULL
);
```

- **Loading a page** = `SELECT data … ORDER BY seq`, then apply each update to a new `Doc`.
- **The core keeps loaded docs in a cache** (`HashMap<PageId, Doc>`). The cache is only a
  speed-up. Any entry can be dropped (`evict_all()`) and replayed from the log.
- **Compaction** (`Core::compact(page)`) merges all of a page's rows into one with
  `yrs::merge_updates_v1`, inside a SQLite transaction. The test checks that the document
  and the index are byte-for-byte the same afterwards.
- SQLite runs in **WAL mode**, which suits many small appends and lets reads run during writes.

### 5.1 How a local transaction becomes one update

```rust
let before = doc.transact().state_vector();   // "what I had"
{ run the closure on doc.transact_mut() }      // edit
let update = doc.transact().encode_diff_v1(&before);  // "exactly what's new"
if update != Update::EMPTY_V1 { commit(update) }      // no-op transactions write nothing
```

A **state vector** is a small summary of "how much of each writer's history I have". Diffing
against it gives exactly the new changes.

### 5.2 Updates from an editor

`Core::apply_update(page, bytes)`:
1. Decodes the bytes first. Garbage is rejected before anything else happens (`Error::Decode`).
2. Applies the update to the cached doc.
3. Logs **the raw incoming bytes**, not a re-encoding. An update can depend on changes we have
   not received yet. yrs holds those parts as "pending", and re-encoding the doc would drop
   them, so they would be lost on restart. The raw bytes keep them.

To send data to an editor, use `Core::encode_update_for(page, Some(editor_state_vector))`,
which returns only what the editor is missing. With `None`, it returns the whole page.

---

## 6. The index (projection)

File: `crates/bw-core/src/index.rs`

```sql
blocks  (id PK, page_id, parent_id, flavour, position, depth, text)
props   (block_id, page_id, key, value JSON,  PK(block_id, key))
refs    (src_block, page_id, target, kind ∈ {'block','page'})
db_rows (database_id, row_id, page_id, position)
index_state (page_id PK, indexed_seq)   -- last log seq this page's projection reflects
```

What each table is for:

- **`blocks`**: every block that can be reached from a page root. Lets you fetch the children
  of X, or full-text search later.
- **`props`**: one row per property, stored as JSON, so SQLite's `json_extract` works:
  `SELECT … WHERE key='course.progress' AND json_extract(value,'$') < 1`.
- **`refs`**: links found in text. `((block-id))` is a **block reference** and `[[page-id]]` is a
  **page link**. This makes backlinks one indexed lookup: `Core::backlinks(id)`.
- **`db_rows`**: every direct child of a `database` block. This is the hook for the
  Database/Views phase.
- **`index_state`**: lets the core detect a stale or missing index on startup (see 6.2).

### 6.1 How a page is projected

The spike uses the simplest strategy that is certainly correct: **delete all of the page's
index rows, then re-insert them from its snapshot.** This runs in the same SQLite transaction
as the log append, so the log and the index can never disagree after a write.

This is fine because the architecture keeps pages small (*"don't put a 10,000-row table into
one Y.Doc"*). A smarter projector that only touches changed blocks can replace
`project_page` later without changing any caller.

### 6.2 Rebuild

`Core::rebuild_index()`:
1. `DROP`s every projected table and recreates it empty, so there is no chance of reusing
   anything stale.
2. For each page, replays its log into a **fresh** Doc. It deliberately ignores the cache, to
   prove the index depends on the log alone.
3. Projects each page, all in one SQLite transaction.
4. Emits `Event::IndexRebuilt`.

There is also an **automatic catch-up on open**: for each page, if `index_state.indexed_seq`
does not equal the log's last `seq`, that page is re-projected. So if someone deletes the
index tables, or a future version changes the projector and bumps the state, the next start
fixes it. The test `deleted_index_is_rebuilt_on_open` drops every index table behind the
core's back, reopens, and gets an identical index.

---

## 7. The event bus

File: `crates/bw-core/src/events.rs`

`core.subscribe()` returns a channel receiver. After a successful commit, which means the log
and the index are both written, subscribers get one of these:

```rust
Event::PageCreated  { page_id, seq }
Event::PageChanged  { page_id, seq, origin: Origin::Local | Origin::Remote }
Event::IndexRebuilt { pages }
```

This is the "live" path from the architecture doc: *widget → core → yrs update → index → event
bus → every subscriber*. A widget that hears `PageChanged` re-runs its SQL query and sees the
new data, because the index was already updated before the event was sent.

---

## 8. Failure handling (worth understanding)

**yrs has no rollback.** Once you edit a Y.Doc in memory, the change can't be undone. So what
happens if a transaction closure fails halfway, or SQLite fails to commit?

The core **evicts that page's doc from the cache** and returns the error. Nothing was written
to the log, so the next access replays the log and gets the last good state. The test
`failed_transaction_persists_nothing` makes a real edit, then fails, and checks that the edit
is gone.

So the in-memory doc is never trusted more than the log.

---

## 9. Results from the demo

Run it yourself:

```bash
cargo run -p bw-core --example demo --release            # default: 200 pages × 40 blocks
cargo run -p bw-core --example demo --release -- 500 40  # custom size
```

Output on the dev container (in-memory SQLite, release build):

```text
== 1. create a page and add blocks in one transaction
  page      "Rust course"  {"course.source_path": String("~/Courses/rust")}
    heading   "Week 1"
    paragraph "Ownership"
      paragraph "Recap of ((8c438548-…))"
    database  "Lessons"
      page      "Lesson 1"  {"course.progress": Number(1)}
      page      "Lesson 2"  {"course.progress": Number(0.5)}
      page      "Lesson 3"  {"course.progress": Number(0)}

== 2. the truth: the update log
  seq 1: 305 bytes
  seq 2: 2391 bytes

== 5. rebuild benchmark: 200 pages x 40 blocks, 1 update per block
  live writes:   5.19s (8200 transactions)
  full rebuild:  208ms (200 pages, 8200 blocks, 8200 updates replayed)
  rebuilt index == live index: true
  compact all:   42ms
  rebuild after compaction: 201ms (200 updates replayed)
```

How to read these numbers:
- **Rebuild is cheap.** About 25 ms per 1,000 blocks, so a large vault of 100k blocks is in the
  low seconds. "The index is disposable" is practical, not just a theory.
- **Live writes cost about 0.6 ms each**, mostly because the spike re-projects the whole page
  and commits a SQLite transaction on every write. That is fast enough for typing if the
  editor batches keystrokes (it would send one update every few hundred ms, not one per
  character). A diff-based projector would cut this further.
- **Compaction shrinks the log** (8200 → 200 rows) without changing the result.

---

## 10. How to run everything

```bash
cargo test                                   # 12 acceptance tests
cargo run -p bw-core --example demo          # walkthrough + benchmark
cargo clippy --all-targets                   # lint, currently clean
```

## 11. File map

```text
Cargo.toml                       workspace
crates/bw-core/
  Cargo.toml                     deps: yrs 0.28, rusqlite 0.41 (bundled SQLite), serde_json, thiserror, uuid
  src/lib.rs                     public API re-exports
  src/schema.rs                  block layout, flavours, BlockSnapshot / PageSnapshot
  src/doc.rs                     BlockTxn (block operations on a Y.Doc) + snapshot()
  src/store.rs                   update log: append, load/replay, compact
  src/index.rs                   projection tables, project_page, ref extraction, dump
  src/core.rs                    Core: the single writer, the write path, rebuild, queries
  src/events.rs                  event bus
  src/error.rs                   Error type
  tests/spike.rs                 the 12 acceptance tests
  examples/demo.rs               walkthrough + benchmark
```

---

## 12. Known limits and decisions left for later

These are deliberate scope cuts, listed so they don't come as a surprise later:

1. **Concurrent moves can orphan or duplicate a block.** A move is "remove from A's children,
   add to B's children". If two replicas move the same block at the same time to different
   parents, both inserts survive the merge. `snapshot` handles this safely: the first
   occurrence wins and duplicates are skipped. Blocks that are no longer reachable are left
   out of the page. A proper fix (for example, treating the `parent` field as the authority
   and repairing `children`) belongs in a later phase. It only matters once there is real
   multi-device sync.
2. **Refs use a placeholder syntax** (`((id))`, `[[id]]` inside plain text). Once the doc-mode
   editor exists, refs should be inline embeds or marks in the Y.Text, and `extract_refs`
   should read those instead. Only that one function changes.
3. **Whole-page re-projection.** Correct and simple. Switch to diff-based when profiling says so.
4. **One SQLite connection, single-threaded `Core`.** In the Tauri app it would sit behind a
   `Mutex` or an actor task, with commands sent over a channel. That is natural for a single
   writer.
5. **`set_text` replaces the whole text.** Fine for core-side automation. Editors should send
   fine-grained Y.Text updates through `apply_update`, or use `insert_text`.
6. **Pages can't be deleted yet**, and there is no undo stack. yrs has an `UndoManager`, which
   can be added in the editor phase.
7. **No full-text search table yet.** An FTS5 table fed from `blocks.text` is a small addition
   to `project_page`.
8. **Compaction is manual.** A policy (for example, compact when a page has more than N rows
   or on idle) can come later. Note that compaction drops per-update history.

## 13. What the next phases can rely on

- **Doc-mode editor (phase 2):** bind y-prosemirror (or a custom renderer) to the page's
  `blocks` map, sync with `encode_update_for` / `apply_update`, and listen to events.
- **Database + views (phase 3):** `db_rows` + `props` already answer "rows of DB X with their
  properties". A view is a saved SQL query over these tables.
- **Widget API (phase 4):** `db.mutate` = `Core::transact`; `db.subscribe` = the event bus
  plus re-running the query.
- **Markdown export (phase 7):** walk `snapshot()` (plain data, already in document order) and
  write files. Like the index, it is another projection.
