//! Two-way sync between workspaces (the desktop app and a BrainWaves server).
//!
//! Pages are CRDTs, so syncing a page is exchanging what each side is missing: one side sends
//! its state vector, the other answers with the updates that vector doesn't cover. Merges are
//! automatic. What the core adds here:
//! - a **change feed**: the pages changed and deleted since a cursor, so a sync round only
//!   looks at what moved (`changes_since`);
//! - **tombstones**: deleting a page forever is not a CRDT change (its log is removed), so it's
//!   recorded in `deleted_pages` and sent to the other side;
//! - `apply_remote`: merge a page's update from elsewhere, creating the page if it's new here,
//!   and writing nothing when the update brings nothing new (so two sides settle instead of
//!   echoing the same change back and forth);
//! - a small key/value table for the sync settings (`sync_kv`).

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, StateVector, Transact, Update};

use crate::core::Core;
use crate::error::{Error, Result};
use crate::store;

/// Where a change feed got to: the last update and the last deletion seen.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cursor {
    pub updates: i64,
    pub deletes: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    /// Pages with updates after the cursor (that still exist).
    pub pages: Vec<String>,
    /// Pages deleted forever after the cursor.
    pub deleted: Vec<String>,
    pub cursor: Cursor,
}

pub(crate) fn migrate(conn: &rusqlite::Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS deleted_pages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id    TEXT    NOT NULL,
            deleted_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_kv (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;
    Ok(())
}

pub(crate) fn record_deletion(conn: &rusqlite::Connection, page_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO deleted_pages(page_id, deleted_at) VALUES (?1, ?2)",
        params![page_id, store::now_millis()],
    )?;
    Ok(())
}

impl Core {
    /// The newest point of the change feed.
    pub fn sync_cursor(&self) -> Result<Cursor> {
        let seq = |table: &str| -> Result<i64> {
            // sqlite_sequence never goes back, even when the newest rows are deleted.
            Ok(self
                .conn()
                .query_row("SELECT seq FROM sqlite_sequence WHERE name = ?1", [table], |r| r.get::<_, i64>(0))
                .optional()?
                .unwrap_or(0))
        };
        Ok(Cursor {
            updates: seq("updates")?,
            deletes: seq("deleted_pages")?,
        })
    }

    /// The pages changed and deleted since `since`, and the cursor to ask from next time.
    pub fn changes_since(&self, since: Cursor) -> Result<Changes> {
        let cursor = self.sync_cursor()?;
        let mut stmt = self.conn().prepare(
            "SELECT DISTINCT u.page_id FROM updates u JOIN pages p ON p.page_id = u.page_id
             WHERE u.seq > ?1 AND u.seq <= ?2 ORDER BY u.page_id",
        )?;
        let pages = stmt
            .query_map(params![since.updates, cursor.updates], |r| r.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        let mut stmt = self.conn().prepare(
            "SELECT DISTINCT page_id FROM deleted_pages WHERE id > ?1 AND id <= ?2 ORDER BY page_id",
        )?;
        let deleted = stmt
            .query_map(params![since.deletes, cursor.deletes], |r| r.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(Changes { pages, deleted, cursor })
    }

    pub fn page_exists(&self, page_id: &str) -> Result<bool> {
        store::page_exists(self.conn(), page_id)
    }

    /// A page's state vector (empty if the page isn't here).
    pub fn state_vector(&mut self, page_id: &str) -> Result<Vec<u8>> {
        if !self.page_exists(page_id)? {
            return Ok(StateVector::default().encode_v1());
        }
        Ok(self.with_doc(page_id, |doc| doc.transact().state_vector().encode_v1())?)
    }

    /// Merge an update made elsewhere into a page, creating the page if it's new here.
    /// Returns whether anything changed; an update that brings nothing new writes nothing.
    pub fn apply_remote(&mut self, page_id: &str, update: &[u8]) -> Result<bool> {
        let decoded = Update::decode_v1(update).map_err(|e| Error::Decode(e.to_string()))?;
        if decoded.is_empty() {
            return Ok(false);
        }
        if !self.page_exists(page_id)? {
            store::insert_page(self.conn(), page_id)?;
        }
        let before = self.with_doc(page_id, |doc| doc.transact().snapshot())?;
        let applied = self.with_doc(page_id, |doc| doc.transact_mut().apply_update(decoded).map_err(|e| e.to_string()))?;
        if let Err(e) = applied {
            self.evict(page_id);
            return Err(Error::Apply(e));
        }
        let (after, waiting) = self.with_doc(page_id, |doc| {
            let t = doc.transact();
            (t.snapshot(), t.has_missing_updates())
        })?;
        if after == before && !waiting {
            return Ok(false);
        }
        self.commit_remote(page_id, update)?;
        Ok(true)
    }

    pub fn sync_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT value FROM sync_kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn sync_set(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(v) => self.conn().execute(
                "INSERT INTO sync_kv(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, v],
            )?,
            None => self.conn().execute("DELETE FROM sync_kv WHERE key = ?1", [key])?,
        };
        Ok(())
    }

    /// This workspace's own id, made the first time it's asked for. A sync client uses it to
    /// notice it's talking to a different server than before.
    pub fn workspace_id(&self) -> Result<String> {
        if let Some(id) = self.sync_get("workspace_id")? {
            return Ok(id);
        }
        let id = crate::schema::new_id();
        self.sync_set("workspace_id", Some(&id))?;
        Ok(id)
    }
}

/// The other side of a sync: a BrainWaves server over HTTP, or another core in tests.
pub trait Remote {
    /// Its pages changed and deleted since `since`.
    fn changes(&mut self, since: Cursor) -> std::result::Result<Changes, String>;
    /// Given our state vector of a page: the updates we're missing, and its state vector.
    fn page(&mut self, page_id: &str, state_vector: &[u8]) -> std::result::Result<(Vec<u8>, Vec<u8>), String>;
    /// Merge our update of a page there; whether it changed anything there.
    fn push(&mut self, page_id: &str, update: &[u8]) -> std::result::Result<bool, String>;
    /// Delete pages there (they were deleted forever here).
    fn delete(&mut self, page_ids: &[String]) -> std::result::Result<(), String>;
}

/// How far each side's change feed has been synced.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncState {
    pub local: Cursor,
    pub remote: Cursor,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Pages whose changes were sent.
    pub sent: usize,
    /// Pages that changed here because of the other side.
    pub received: usize,
    /// Pages deleted here because they were deleted there, and the other way round.
    pub deleted_here: usize,
    pub deleted_there: usize,
}

/// One sync round between this workspace and `remote`. The core is locked only for local
/// steps, never while waiting for the other side. Run it again until it reports no work:
/// changes made during a round (or by the round itself) are picked up by the next one.
pub fn sync_round<R: Remote>(local: &std::sync::Mutex<Core>, remote: &mut R, state: &mut SyncState) -> std::result::Result<Report, String> {
    let lock = || local.lock().map_err(|e| e.to_string());
    let ours = lock()?.changes_since(state.local).map_err(|e| e.to_string())?;
    let theirs = remote.changes(state.remote)?;
    let mut report = Report::default();

    // Deletions first: a page deleted on either side is gone on both.
    for id in &theirs.deleted {
        let mut core = lock()?;
        if core.page_exists(id).map_err(|e| e.to_string())? {
            core.delete_pages(std::slice::from_ref(id)).map_err(|e| e.to_string())?;
            report.deleted_here += 1;
        }
    }
    let send: Vec<String> = ours.deleted.iter().filter(|id| !theirs.deleted.contains(id)).cloned().collect();
    if !send.is_empty() {
        remote.delete(&send)?;
        report.deleted_there = send.len();
    }
    let gone = |id: &String| ours.deleted.contains(id) || theirs.deleted.contains(id);

    let mut touched: Vec<String> = ours.pages.iter().chain(theirs.pages.iter()).filter(|id| !gone(id)).cloned().collect();
    touched.sort();
    touched.dedup();
    for id in touched {
        let sv = lock()?.state_vector(&id).map_err(|e| e.to_string())?;
        let (update, their_sv) = remote.page(&id, &sv)?;
        let mut core = lock()?;
        if !update.is_empty() && core.apply_remote(&id, &update).map_err(|e| e.to_string())? {
            report.received += 1;
        }
        if !core.page_exists(&id).map_err(|e| e.to_string())? {
            continue;
        }
        // Send ours when it changed here, or the other side lacks something we have.
        // (Deletions inside a page don't move the state vector, so "changed here" counts.)
        let our_sv = core.state_vector(&id).map_err(|e| e.to_string())?;
        if ours.pages.contains(&id) || our_sv != their_sv {
            let diff = core.encode_update_for(&id, Some(&their_sv)).map_err(|e| e.to_string())?;
            drop(core);
            if remote.push(&id, &diff)? {
                report.sent += 1;
            }
        }
    }
    state.local = ours.cursor;
    state.remote = theirs.cursor;
    Ok(report)
}
