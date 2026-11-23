//! `Core`: the single writer. Every change to every page goes through here.
//!
//! The write path, for both local transactions and updates coming from an editor:
//!
//! ```text
//!  1. change the in-memory Y.Doc            (yrs)
//!  2. encode exactly what changed           (one yrs update, v1 encoding)
//!  3. in ONE SQLite transaction:
//!       append the update to `updates`      (truth)
//!       re-project the page into the index  (pages / blocks / props / refs / tags)
//!  4. emit an event on the bus              (subscribers re-query)
//! ```
//!
//! Because steps 3a and 3b commit together, the index can never be ahead of or behind
//! the log after a successful write.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use yrs::updates::decoder::Decode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::doc::{self, BlockTxn};
use crate::error::{Error, Result};
use crate::events::{Event, EventBus, Origin};
use crate::index::{self, IndexDump, PageTimes};
use crate::schema::{new_id, PageId, PageMeta, PageMetaPatch, PageSnapshot};
use crate::store;

pub struct Core {
    conn: Connection,
    path: Option<PathBuf>,
    /// Loaded pages. A cache only: any entry can be evicted and replayed from the log.
    docs: HashMap<PageId, Doc>,
    pub(crate) bus: EventBus,
    /// Bumped whenever the set of folders modules may read changes (see `modules.rs`).
    pub(crate) watch_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebuildReport {
    pub pages: usize,
    pub blocks: usize,
    pub updates_replayed: usize,
    pub elapsed: Duration,
}

impl Core {
    /// Open (or create) a workspace database file.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let mut core = Self::init(Connection::open(path.as_ref())?)?;
        core.path = Some(path.as_ref().to_path_buf());
        Ok(core)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        store::migrate(&conn)?;
        crate::sync::migrate(&conn)?;
        index::prepare(&conn)?;
        let mut core = Self {
            conn,
            path: None,
            docs: HashMap::new(),
            bus: EventBus::default(),
            watch_generation: 0,
        };
        core.catch_up_index()?;
        core.register_course_module()?;
        core.register_dnd_module()?;
        core.register_burrow_module()?;
        core.register_para_module()?;
        Ok(core)
    }

    /// The database file, if this core is backed by one.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    // ------------------------------------------------------------------ writes

    /// Create a page with a fresh id. It starts with one note holding one empty paragraph.
    pub fn create_page(&mut self, meta: PageMeta) -> Result<PageId> {
        self.create_page_with_id(&new_id(), meta)
    }

    /// Create a page with an id chosen by the caller (the UI picks ids so it can show the
    /// page before the write returns).
    pub fn create_page_with_id(&mut self, page_id: &str, mut meta: PageMeta) -> Result<PageId> {
        if store::page_exists(&self.conn, page_id)? {
            return Err(Error::Invalid(format!("page {page_id} already exists")));
        }
        // A page needs a sort key to be placed among its siblings (and dragged between them):
        // one made without one goes after the others.
        if meta.key.is_empty() {
            meta.key = self.key_after_siblings(meta.parent_id.as_deref())?;
        }
        let doc = Doc::new();
        doc::init_page(&doc, page_id, &meta);
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let snap = doc::snapshot(&doc, page_id)?;

        let tx = self.conn.transaction()?;
        store::insert_page(&tx, page_id)?;
        let seq = store::append_update(&tx, page_id, &update)?;
        let (created_at, updated_at) = store::page_times(&tx, page_id)?;
        index::project_page(
            &tx,
            &snap,
            seq,
            &PageTimes {
                created_at,
                updated_at,
            },
        )?;
        tx.commit()?;

        self.docs.insert(page_id.to_string(), doc);
        self.bus.emit(Event::PageCreated {
            page_id: page_id.to_string(),
            seq,
        });
        Ok(page_id.to_string())
    }

    /// Import a page built elsewhere (e.g. converted from another app) as a single update.
    ///
    /// `update` must encode a complete page in the schema-2 layout whose `page.id` is
    /// `page_id` and that has at least one note. It is validated before anything is written.
    /// The page keeps its original dates: `created_at` becomes its creation time and
    /// `updated_at` the time of its (only) log entry.
    pub fn import_page(
        &mut self,
        page_id: &str,
        update: &[u8],
        created_at: i64,
        updated_at: i64,
    ) -> Result<()> {
        if store::page_exists(&self.conn, page_id)? {
            return Err(Error::Invalid(format!("page {page_id} already exists")));
        }
        let decoded = Update::decode_v1(update).map_err(|e| Error::Decode(e.to_string()))?;
        let doc = Doc::new();
        doc.transact_mut()
            .apply_update(decoded)
            .map_err(|e| Error::Apply(e.to_string()))?;
        let snap = doc::snapshot(&doc, page_id)?;
        if doc::stored_page_id(&doc).as_deref() != Some(page_id) {
            return Err(Error::Invalid(
                "page.id in the document does not match".into(),
            ));
        }
        if snap.notes().next().is_none() {
            return Err(Error::Invalid(
                "an imported page needs at least one note".into(),
            ));
        }

        let tx = self.conn.transaction()?;
        store::insert_page_at(&tx, page_id, created_at)?;
        let seq = store::append_update_at(&tx, page_id, update, updated_at.max(created_at))?;
        let (created_at, updated_at) = store::page_times(&tx, page_id)?;
        index::project_page(
            &tx,
            &snap,
            seq,
            &PageTimes {
                created_at,
                updated_at,
            },
        )?;
        tx.commit()?;

        self.docs.insert(page_id.to_string(), doc);
        self.bus.emit(Event::PageCreated {
            page_id: page_id.to_string(),
            seq,
        });
        Ok(())
    }

    /// Change page metadata (title, icon, parent, sort key, favorite, archived, trashed).
    pub fn update_page(&mut self, page_id: &str, patch: &PageMetaPatch) -> Result<()> {
        self.transact(page_id, |tx| {
            tx.set_meta(patch);
            Ok(())
        })
    }

    /// Permanently delete pages: their logs and their index rows. Trash is just
    /// `trashed_at` in the metadata; this is "delete forever".
    pub fn delete_pages(&mut self, ids: &[String]) -> Result<()> {
        let tx = self.conn.transaction()?;
        for id in ids {
            // A tombstone, so a synced workspace deletes the page too.
            if store::page_exists(&tx, id)? {
                crate::sync::record_deletion(&tx, id)?;
            }
            store::delete_page(&tx, id)?;
            index::clear_page(&tx, id)?;
            tx.execute("DELETE FROM index_state WHERE page_id = ?1", [id])?;
        }
        tx.commit()?;
        for id in ids {
            self.docs.remove(id);
            self.bus.emit(Event::PageDeleted {
                page_id: id.clone(),
            });
        }
        Ok(())
    }

    /// Run block operations on a page as one transaction.
    ///
    /// If `f` returns an error, nothing is persisted. yrs has no rollback, so the page's
    /// in-memory doc is evicted and will be replayed from the log on next access.
    pub fn transact<R>(
        &mut self,
        page_id: &str,
        f: impl FnOnce(&mut BlockTxn) -> Result<R>,
    ) -> Result<R> {
        self.ensure_loaded(page_id)?;
        let doc = &self.docs[page_id];
        let before = doc.transact().state_vector();
        let maps = doc::doc_maps(doc);

        let result = {
            let mut txn = doc.transact_mut();
            let mut btx = BlockTxn::new(&mut txn, maps, page_id.to_string());
            f(&mut btx)
        };
        let value = match result {
            Ok(v) => v,
            Err(e) => {
                self.docs.remove(page_id);
                return Err(e);
            }
        };

        let update = doc.transact().encode_diff_v1(&before);
        if update.as_slice() != Update::EMPTY_V1 {
            self.commit(page_id, &update, Origin::Local)?;
        }
        Ok(value)
    }

    /// Apply a yrs update produced elsewhere (e.g. by the editor's Y.Doc in the frontend).
    ///
    /// The raw bytes are what gets logged: the update may depend on data we have not seen
    /// yet, and yrs keeps such parts pending, so re-encoding could drop them.
    pub fn apply_update(&mut self, page_id: &str, update: &[u8]) -> Result<()> {
        let decoded = Update::decode_v1(update).map_err(|e| Error::Decode(e.to_string()))?;
        if decoded.is_empty() {
            return Ok(());
        }
        self.ensure_loaded(page_id)?;
        let applied = self.docs[page_id].transact_mut().apply_update(decoded);
        if let Err(e) = applied {
            self.docs.remove(page_id);
            return Err(Error::Apply(e.to_string()));
        }
        self.commit(page_id, update, Origin::Remote).map(|_| ())
    }

    /// Step 3 + 4 of the write path. On failure the cached doc is evicted, because it now
    /// holds a change the log does not.
    fn commit(&mut self, page_id: &str, update: &[u8], origin: Origin) -> Result<i64> {
        let res = (|| {
            let snap = doc::snapshot(&self.docs[page_id], page_id)?;
            let tx = self.conn.transaction()?;
            let seq = store::append_update(&tx, page_id, update)?;
            let (created_at, updated_at) = store::page_times(&tx, page_id)?;
            index::project_page(
                &tx,
                &snap,
                seq,
                &PageTimes {
                    created_at,
                    updated_at,
                },
            )?;
            tx.commit()?;
            Ok(seq)
        })();
        match res {
            Ok(seq) => {
                self.bus.emit(Event::PageChanged {
                    page_id: page_id.to_string(),
                    seq,
                    origin,
                });
                Ok(seq)
            }
            Err(e) => {
                self.docs.remove(page_id);
                Err(e)
            }
        }
    }

    /// Merge a page's update log into a single row. Returns how many rows were merged.
    pub fn compact(&mut self, page_id: &str) -> Result<usize> {
        let merged = store::compact(&mut self.conn, page_id)?;
        if merged > 0 {
            // The log's last seq changed, so record it against the (unchanged) projection.
            let seq = store::last_seq(&self.conn, page_id)?;
            self.conn.execute(
                "UPDATE index_state SET indexed_seq = ?1 WHERE page_id = ?2",
                rusqlite::params![seq, page_id],
            )?;
        }
        Ok(merged)
    }

    // ------------------------------------------------------------------ index

    /// Throw the whole index away and rebuild it by replaying every page's log.
    ///
    /// Deliberately ignores the in-memory doc cache: the point is to prove the index is a
    /// pure function of the log.
    pub fn rebuild_index(&mut self) -> Result<RebuildReport> {
        let started = Instant::now();
        let mut blocks = 0;
        let mut updates_replayed = 0;

        let tx = self.conn.transaction()?;
        index::drop_tables(&tx)?;
        index::create_tables(&tx)?;
        let pages = store::page_ids(&tx)?;
        for page_id in &pages {
            updates_replayed += store::load_updates(&tx, page_id)?.len();
            blocks += Self::reproject(&tx, page_id)?;
        }
        tx.commit()?;

        self.bus.emit(Event::IndexRebuilt { pages: pages.len() });
        Ok(RebuildReport {
            pages: pages.len(),
            blocks,
            updates_replayed,
            elapsed: started.elapsed(),
        })
    }

    /// Replay one page from the log and project it. Returns its block count.
    fn reproject(tx: &rusqlite::Transaction, page_id: &str) -> Result<usize> {
        let doc = store::load_doc(tx, page_id)?;
        let snap = doc::snapshot(&doc, page_id)?;
        let seq = store::last_seq(tx, page_id)?;
        let (created_at, updated_at) = store::page_times(tx, page_id)?;
        index::project_page(
            tx,
            &snap,
            seq,
            &PageTimes {
                created_at,
                updated_at,
            },
        )?;
        Ok(snap.blocks.len())
    }

    /// On open, re-project any page whose index is missing or older than its log
    /// (e.g. the index tables were deleted, or written by an older projector).
    fn catch_up_index(&mut self) -> Result<usize> {
        let mut stale = Vec::new();
        for page_id in store::page_ids(&self.conn)? {
            if index::indexed_seq(&self.conn, &page_id)?
                != Some(store::last_seq(&self.conn, &page_id)?)
            {
                stale.push(page_id);
            }
        }
        for page_id in &stale {
            let tx = self.conn.transaction()?;
            Self::reproject(&tx, page_id)?;
            tx.commit()?;
        }
        Ok(stale.len())
    }

    // ------------------------------------------------------------------ reads

    /// The page as plain data, read from the live Y.Doc.
    pub fn snapshot(&mut self, page_id: &str) -> Result<PageSnapshot> {
        self.ensure_loaded(page_id)?;
        doc::snapshot(&self.docs[page_id], page_id)
    }

    /// Everything a client with state vector `remote_sv` (v1-encoded) is missing.
    /// Pass `None` to get the whole page, e.g. when an editor first opens it.
    pub fn encode_update_for(
        &mut self,
        page_id: &str,
        remote_sv: Option<&[u8]>,
    ) -> Result<Vec<u8>> {
        let sv = match remote_sv {
            Some(bytes) => {
                StateVector::decode_v1(bytes).map_err(|e| Error::Decode(e.to_string()))?
            }
            None => StateVector::default(),
        };
        self.ensure_loaded(page_id)?;
        Ok(self.docs[page_id].transact().encode_state_as_update_v1(&sv))
    }

    pub fn page_ids(&self) -> Result<Vec<PageId>> {
        store::page_ids(&self.conn)
    }

    /// Number of rows in a page's update log.
    pub fn log_len(&self, page_id: &str) -> Result<usize> {
        Ok(store::load_updates(&self.conn, page_id)?.len())
    }

    /// Ordered dump of every projected table, for comparing two indexes.
    pub fn index_dump(&self) -> Result<IndexDump> {
        index::dump(&self.conn)
    }

    /// Read-only access for ad-hoc SQL against the index (queries live in `query.rs`).
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn subscribe(&mut self) -> Receiver<Event> {
        self.bus.subscribe()
    }

    /// Drop the in-memory docs; the next access replays from the log.
    pub fn evict_all(&mut self) {
        self.docs.clear();
    }

    /// A sort key after every sibling under `parent` (`None`: the top level).
    fn key_after_siblings(&self, parent: Option<&str>) -> Result<String> {
        let last: Option<String> = self.conn.query_row(
            "SELECT MAX(sort_key) FROM page_meta WHERE parent_id IS ?1",
            [parent],
            |r| r.get(0),
        )?;
        Ok(key_after(&last.unwrap_or_default()))
    }

    /// Run `f` on a page's live doc (loaded from the log if needed).
    pub(crate) fn with_doc<R>(&mut self, page_id: &str, f: impl FnOnce(&Doc) -> R) -> Result<R> {
        self.ensure_loaded(page_id)?;
        Ok(f(&self.docs[page_id]))
    }

    /// Forget a page's cached doc; it's replayed from the log on next use.
    pub(crate) fn evict(&mut self, page_id: &str) {
        self.docs.remove(page_id);
    }

    /// Persist and index an update already applied to the cached doc, from elsewhere.
    pub(crate) fn commit_remote(&mut self, page_id: &str, update: &[u8]) -> Result<i64> {
        self.commit(page_id, update, Origin::Remote)
    }

    fn ensure_loaded(&mut self, page_id: &str) -> Result<()> {
        if !self.docs.contains_key(page_id) {
            let doc = store::load_doc(&self.conn, page_id)?;
            self.docs.insert(page_id.to_string(), doc);
        }
        Ok(())
    }
}

/// The fractional sort key right after `a` (the same keys as `apps/desktop/src/lib/fractional.ts`
/// makes with `keyBetween(a, null)`: base-62 digits, short, never ending in '0').
pub(crate) fn key_after(a: &str) -> String {
    const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let first = a.as_bytes().first().copied();
    let da = first.and_then(|c| DIGITS.iter().position(|&d| d == c)).unwrap_or(0);
    let db = DIGITS.len();
    if db - da > 1 {
        return (DIGITS[((da + db) as f64 * 0.5).round() as usize] as char).to_string();
    }
    let rest = if a.is_empty() { "" } else { &a[1..] };
    format!("{}{}", DIGITS[da] as char, key_after(rest))
}

#[cfg(test)]
mod key_tests {
    use super::key_after;

    #[test]
    fn keys_after_match_the_app() {
        // The same keys as the app's keyBetween(k, null): V l t x z …
        let mut seq = vec![];
        let mut k = String::new();
        for _ in 0..5 {
            k = key_after(&k);
            seq.push(k.clone());
        }
        assert_eq!(seq, ["V", "l", "t", "x", "z"]);
        let mut k = String::new();
        for _ in 0..200 {
            let next = key_after(&k);
            assert!(next > k, "{next} > {k}");
            assert!(!next.ends_with('0'));
            k = next;
        }
        // The app's keyBetween gives the same after 200 pages in a row.
        assert_eq!(k, "z".repeat(40));
    }
}
