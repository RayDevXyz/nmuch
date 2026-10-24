//! SQLite storage of the source of truth: the append-only yrs update log.
//!
//! The `pages` and `updates` tables are the only data that cannot be regenerated.
//! Everything the indexer writes (see `index.rs`) can be dropped and rebuilt from here.

use rusqlite::{params, Connection, OptionalExtension};
use yrs::updates::decoder::Decode;
use yrs::{Doc, Transact, Update};

use crate::error::{Error, Result};

pub(crate) fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        -- TRUTH: never dropped, never rewritten except by compaction.
        CREATE TABLE IF NOT EXISTS pages (
            page_id    TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS updates (
            seq        INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id    TEXT    NOT NULL REFERENCES pages(page_id),
            data       BLOB    NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS updates_by_page ON updates(page_id, seq);
        "#,
    )?;
    Ok(())
}

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn insert_page(conn: &Connection, page_id: &str) -> Result<()> {
    insert_page_at(conn, page_id, now_millis())
}

pub(crate) fn insert_page_at(conn: &Connection, page_id: &str, created_at: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO pages(page_id, created_at) VALUES (?1, ?2)",
        params![page_id, created_at],
    )?;
    Ok(())
}

/// (created_at, updated_at): page creation time and the time of its last log entry.
pub(crate) fn page_times(conn: &Connection, page_id: &str) -> Result<(i64, i64)> {
    Ok(conn.query_row(
        "SELECT p.created_at, COALESCE((SELECT MAX(created_at) FROM updates u WHERE u.page_id = p.page_id), p.created_at)
         FROM pages p WHERE p.page_id = ?1",
        [page_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

/// Permanently remove a page and its whole log. The only operation that destroys truth.
pub(crate) fn delete_page(conn: &Connection, page_id: &str) -> Result<()> {
    conn.execute("DELETE FROM updates WHERE page_id = ?1", [page_id])?;
    conn.execute("DELETE FROM pages WHERE page_id = ?1", [page_id])?;
    Ok(())
}

pub(crate) fn page_exists(conn: &Connection, page_id: &str) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM pages WHERE page_id = ?1", [page_id], |_| {
            Ok(())
        })
        .optional()?
        .is_some())
}

pub(crate) fn page_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT page_id FROM pages ORDER BY page_id")?;
    let ids = stmt
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(ids)
}

/// Append one update to the log, returning its sequence number.
pub(crate) fn append_update(conn: &Connection, page_id: &str, data: &[u8]) -> Result<i64> {
    append_update_at(conn, page_id, data, now_millis())
}

pub(crate) fn append_update_at(
    conn: &Connection,
    page_id: &str,
    data: &[u8],
    created_at: i64,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO updates(page_id, data, created_at) VALUES (?1, ?2, ?3)",
        params![page_id, data, created_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// All updates of a page in log order.
pub(crate) fn load_updates(conn: &Connection, page_id: &str) -> Result<Vec<Vec<u8>>> {
    let mut stmt = conn.prepare("SELECT data FROM updates WHERE page_id = ?1 ORDER BY seq")?;
    let rows = stmt
        .query_map([page_id], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}

pub(crate) fn last_seq(conn: &Connection, page_id: &str) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM updates WHERE page_id = ?1",
        [page_id],
        |r| r.get(0),
    )?)
}

/// Rebuild a page's Y.Doc by replaying its log from the beginning.
pub(crate) fn load_doc(conn: &Connection, page_id: &str) -> Result<Doc> {
    if !page_exists(conn, page_id)? {
        return Err(Error::PageNotFound(page_id.to_string()));
    }
    let doc = Doc::new();
    {
        let mut txn = doc.transact_mut();
        for data in load_updates(conn, page_id)? {
            let update = Update::decode_v1(&data).map_err(|e| Error::Decode(e.to_string()))?;
            txn.apply_update(update)
                .map_err(|e| Error::Apply(e.to_string()))?;
        }
    }
    Ok(doc)
}

/// Replace all of a page's log rows with a single merged update. Returns rows removed.
///
/// Merging is lossless: replaying the merged update yields the same document.
pub(crate) fn compact(conn: &mut Connection, page_id: &str) -> Result<usize> {
    let updates = load_updates(conn, page_id)?;
    if updates.len() <= 1 {
        return Ok(0);
    }
    let merged = yrs::merge_updates_v1(&updates).map_err(|e| Error::Decode(e.to_string()))?;
    let (_, last_write) = page_times(conn, page_id)?;
    let tx = conn.transaction()?;
    let removed = tx.execute("DELETE FROM updates WHERE page_id = ?1", [page_id])?;
    // Keep the original time of the last write so "updated at" doesn't jump.
    tx.execute(
        "INSERT INTO updates(page_id, data, created_at) VALUES (?1, ?2, ?3)",
        params![page_id, merged, last_write],
    )?;
    tx.commit()?;
    Ok(removed)
}
