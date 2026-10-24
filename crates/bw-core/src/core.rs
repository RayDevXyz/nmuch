//! `Core`: the single writer. Every change to every page goes through here.
//!
//! The write path, for both local transactions and updates coming from an editor:
//!
//! ```text
//!  1. change the in-memory Y.Doc            (yrs)
//!  2. encode exactly what changed           (one yrs update, v1 encoding)
//!  3. in ONE SQLite transaction:
//!       append the update to `updates`      (truth)
//!       re-project the page into the index  (blocks / props / refs / db_rows)
//!  4. emit an event on the bus              (subscribers re-query)
//! ```
//!
//! Because steps 3a and 3b commit together, the index can never be ahead of or behind
//! the log after a successful write.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use yrs::updates::decoder::Decode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::doc::{self, BlockTxn};
use crate::error::{Error, Result};
use crate::events::{Event, EventBus, Origin};
use crate::index::{self, IndexDump};
use crate::schema::{keys, new_id, BlockId, PageId, PageSnapshot};
use crate::store;

pub struct Core {
    conn: Connection,
    /// Loaded pages. A cache only: any entry can be evicted and replayed from the log.
    docs: HashMap<PageId, Doc>,
    bus: EventBus,
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
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        store::migrate(&conn)?;
        index::create_tables(&conn)?;
        let mut core = Self {
            conn,
            docs: HashMap::new(),
            bus: EventBus::default(),
        };
        core.catch_up_index()?;
        Ok(core)
    }

    // ------------------------------------------------------------------ writes

    /// Create a new page: a Y.Doc whose root block is the page itself.
    pub fn create_page(&mut self, title: &str) -> Result<PageId> {
        let page_id = new_id();
        let doc = Doc::new();
        doc::init_page(&doc, &page_id, title);
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let snap = doc::snapshot(&doc, &page_id)?;

        let tx = self.conn.transaction()?;
        store::insert_page(&tx, &page_id)?;
        let seq = store::append_update(&tx, &page_id, &update)?;
        index::project_page(&tx, &snap, seq)?;
        tx.commit()?;

        self.docs.insert(page_id.clone(), doc);
        self.bus.emit(Event::PageCreated {
            page_id: page_id.clone(),
            seq,
        });
        Ok(page_id)
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
        let blocks = doc.get_or_insert_map(keys::BLOCKS);

        let result = {
            let mut txn = doc.transact_mut();
            let mut btx = BlockTxn::new(&mut txn, blocks, page_id.to_string());
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
            index::project_page(&tx, &snap, seq)?;
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
            let doc = store::load_doc(&tx, page_id)?;
            let snap = doc::snapshot(&doc, page_id)?;
            blocks += snap.blocks.len();
            let seq = store::last_seq(&tx, page_id)?;
            index::project_page(&tx, &snap, seq)?;
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
            let doc = store::load_doc(&self.conn, page_id)?;
            let snap = doc::snapshot(&doc, page_id)?;
            let tx = self.conn.transaction()?;
            let seq = store::last_seq(&tx, page_id)?;
            index::project_page(&tx, &snap, seq)?;
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
        use yrs::updates::decoder::Decode as _;
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

    /// Blocks whose text references `target` via `((target))` or `[[target]]`.
    pub fn backlinks(&self, target: &str) -> Result<Vec<BlockId>> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT src_block FROM refs WHERE target = ?1 ORDER BY src_block")?;
        let rows = stmt
            .query_map([target], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    /// Blocks where property `key` equals `value`.
    pub fn blocks_with_prop(&self, key: &str, value: &serde_json::Value) -> Result<Vec<BlockId>> {
        let mut stmt = self.conn.prepare(
            "SELECT block_id FROM props WHERE key = ?1 AND value = ?2 ORDER BY block_id",
        )?;
        let rows = stmt
            .query_map([key, &value.to_string()], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    /// Row ids of a database block, in order.
    pub fn db_rows(&self, database_id: &str) -> Result<Vec<BlockId>> {
        let mut stmt = self
            .conn
            .prepare("SELECT row_id FROM db_rows WHERE database_id = ?1 ORDER BY position")?;
        let rows = stmt
            .query_map([database_id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    /// Ordered dump of every projected table, for comparing two indexes.
    pub fn index_dump(&self) -> Result<IndexDump> {
        index::dump(&self.conn)
    }

    /// Read-only access for ad-hoc SQL against the index (e.g. in the demo).
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

    fn ensure_loaded(&mut self, page_id: &str) -> Result<()> {
        if !self.docs.contains_key(page_id) {
            let doc = store::load_doc(&self.conn, page_id)?;
            self.docs.insert(page_id.to_string(), doc);
        }
        Ok(())
    }
}
