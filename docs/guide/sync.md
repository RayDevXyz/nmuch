# Two-way sync: desktop app ⇄ your server

The desktop app keeps its workspace on your computer and syncs it with your BrainWaves server, in both directions:
- You can write offline. Changes sync when you're back online.
- Changes made in several places, such as the laptop and the web app on your phone, merge automatically.

## Setting it up

1. **Make a token on the server.** In the web app, go to Settings → **Account and API tokens** → **New token**. Name it after the computer, for example "Laptop". Copy the token; it's shown only once.
2. **Connect the desktop app.** Go to Settings → **Sync with a server…**. Enter the server's address (for example `https://brainwaves.goofyme.dev`) and the token, then click **Continue**.
3. **Choose how to start.** The app shows how many pages each side has. Pick one:
   - **Keep both:** this computer's pages go to the server, and the server's pages come here.
   - **Use the server's pages:** the pages on this computer are removed first. Use this for a fresh install, so you don't end up with two copies of the starter pages.
4. Click **Connect and sync**.

## Day to day

**When it syncs:**
- a few seconds after you change something;
- every 30 seconds, to pick up changes made elsewhere;
- when you click **Sync now** in the same dialog.

**Status chip:** a chip next to the search icon, right of the open tabs, shows **Synced**, **Syncing** or **Not synced**. **Not synced** means, for example, that you're offline or the token was removed. Click the chip to see why.

**What syncs:** all pages and everything in them. That includes text, tables, databases and their rows, the canvas, headers, page properties, the trash, and deleting forever.

**What doesn't:**
- app settings, such as theme and text size;
- installed widgets and modules;
- course folders and other things tied to files on this computer.

**Stop syncing** disconnects. Your pages stay on both sides.

**More than one computer:** each one gets its own token. They all sync through the server.

## How it works

Every page is a Yjs CRDT, stored as a log of updates. To sync a page, each side tells the other what it already has (its state vector) and receives only what it's missing. Merging is built into the CRDT, so there are no conflicts to resolve.

Each sync round (`bw_core::sync::sync_round`):
1. Ask each side what changed since the last round. Each side keeps a change feed over its update log and its deletion log.
2. Apply deletions on both sides. A page deleted forever on one side is deleted on the other, even if it was edited there meanwhile.
3. Exchange the pages that changed on either side:
   - send our state vector and merge what comes back;
   - then send what the other side lacks, but only if this page changed here or the other side is behind.
4. Remember both feeds' positions.

Merging an update that brings nothing new writes nothing, so the two sides settle instead of echoing changes back and forth. "Delete forever" removes a page's log, so it leaves a tombstone (`deleted_pages`) for the other side to act on.

**Server commands** (normal API, with the token):

| Command | What it does |
|---|---|
| `syncHello` | the server workspace's id and page count |
| `syncChanges { since }` | pages changed and deleted since a cursor |
| `syncPage { pageId, stateVector }` | what we lack, plus the server's state vector |
| `syncPush { pageId, update }` | merge our update; returns whether anything changed |
| `syncDelete { ids }` | delete forever |

**Desktop commands:** `syncConnect`, `syncNow`, `syncStatus`, `syncDisconnect`.

The settings and the feed positions are kept in the workspace (`sync_kv`). If the server's workspace id changes (a different or reset server), the next sync compares every page again.

**Tests:**
- `crates/bw-core/tests/sync.rs`: two workspaces through the interface; covers merges, deletions, no echo, and a second computer.
- `crates/bw-server/tests/sync.rs`: the real HTTP path with a token.
