//! The SQL index: a disposable projection of page snapshots into queryable tables.
//!
//! Every table here can be dropped at any time and rebuilt from the update log with
//! [`crate::Core::rebuild_index`]. Nothing in here is ever read back into a Y.Doc.

use rusqlite::{params, Connection, Transaction};

use crate::error::Result;
use crate::schema::{flavour, PageSnapshot};

const CREATE_PROJECTION: &str = r#"
    CREATE TABLE IF NOT EXISTS blocks (
        id        TEXT PRIMARY KEY,
        page_id   TEXT    NOT NULL,
        parent_id TEXT,
        flavour   TEXT    NOT NULL,
        position  INTEGER NOT NULL,
        depth     INTEGER NOT NULL,
        text      TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS blocks_by_page   ON blocks(page_id);
    CREATE INDEX IF NOT EXISTS blocks_by_parent ON blocks(parent_id, position);

    -- One row per (block, property). value is JSON; query it with json_extract().
    CREATE TABLE IF NOT EXISTS props (
        block_id TEXT NOT NULL,
        page_id  TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (block_id, key)
    );
    CREATE INDEX IF NOT EXISTS props_by_key ON props(key, value);

    -- Links found in block text: ((block-id)) is a block ref, [[page-id]] a page link.
    CREATE TABLE IF NOT EXISTS refs (
        src_block TEXT NOT NULL,
        page_id   TEXT NOT NULL,
        target    TEXT NOT NULL,
        kind      TEXT NOT NULL CHECK (kind IN ('block', 'page'))
    );
    CREATE INDEX IF NOT EXISTS refs_by_target ON refs(target);

    -- Rows are blocks: any direct child of a `database` block is a row of it.
    CREATE TABLE IF NOT EXISTS db_rows (
        database_id TEXT    NOT NULL,
        row_id      TEXT    NOT NULL,
        page_id     TEXT    NOT NULL,
        position    INTEGER NOT NULL,
        PRIMARY KEY (database_id, row_id)
    );

    -- Bookkeeping: the last log entry each page's projection reflects.
    CREATE TABLE IF NOT EXISTS index_state (
        page_id     TEXT PRIMARY KEY,
        indexed_seq INTEGER NOT NULL
    );
"#;

const PROJECTED_TABLES: [&str; 5] = ["blocks", "props", "refs", "db_rows", "index_state"];

pub(crate) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(CREATE_PROJECTION)?;
    Ok(())
}

pub(crate) fn drop_tables(conn: &Connection) -> Result<()> {
    for t in PROJECTED_TABLES {
        conn.execute_batch(&format!("DROP TABLE IF EXISTS {t};"))?;
    }
    Ok(())
}

/// Replace everything the index knows about one page with `snap`.
///
/// Spike strategy: delete-and-reinsert the whole page. Pages are small (large tables
/// keep one row per block, per the architecture doc), so this stays cheap; a diff-based
/// projector can replace it later without changing any caller.
pub(crate) fn project_page(tx: &Transaction, snap: &PageSnapshot, seq: i64) -> Result<()> {
    clear_page(tx, &snap.page_id)?;

    let mut ins_block = tx.prepare_cached(
        "INSERT INTO blocks(id, page_id, parent_id, flavour, position, depth, text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    let mut ins_prop = tx.prepare_cached(
        "INSERT INTO props(block_id, page_id, key, value) VALUES (?1, ?2, ?3, ?4)",
    )?;
    let mut ins_ref = tx.prepare_cached(
        "INSERT INTO refs(src_block, page_id, target, kind) VALUES (?1, ?2, ?3, ?4)",
    )?;
    let mut ins_row = tx.prepare_cached(
        "INSERT INTO db_rows(database_id, row_id, page_id, position) VALUES (?1, ?2, ?3, ?4)",
    )?;

    for b in &snap.blocks {
        ins_block.execute(params![
            b.id, b.page_id, b.parent, b.flavour, b.position, b.depth, b.text
        ])?;
        for (k, v) in &b.props {
            ins_prop.execute(params![b.id, b.page_id, k, v.to_string()])?;
        }
        for (target, kind) in extract_refs(&b.text) {
            ins_ref.execute(params![b.id, b.page_id, target, kind])?;
        }
        if let Some(parent) = &b.parent {
            let parent_is_db = snap
                .get(parent)
                .is_some_and(|p| p.flavour == flavour::DATABASE);
            if parent_is_db {
                ins_row.execute(params![parent, b.id, b.page_id, b.position])?;
            }
        }
    }

    tx.execute(
        "INSERT INTO index_state(page_id, indexed_seq) VALUES (?1, ?2)
         ON CONFLICT(page_id) DO UPDATE SET indexed_seq = excluded.indexed_seq",
        params![snap.page_id, seq],
    )?;
    Ok(())
}

fn clear_page(tx: &Transaction, page_id: &str) -> Result<()> {
    for t in ["blocks", "props", "refs", "db_rows"] {
        tx.execute(&format!("DELETE FROM {t} WHERE page_id = ?1"), [page_id])?;
    }
    Ok(())
}

pub(crate) fn indexed_seq(conn: &Connection, page_id: &str) -> Result<Option<i64>> {
    use rusqlite::OptionalExtension;
    Ok(conn
        .query_row(
            "SELECT indexed_seq FROM index_state WHERE page_id = ?1",
            [page_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Find `((target))` block refs and `[[target]]` page links in a block's text.
pub fn extract_refs(text: &str) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    for (open, close, kind) in [("((", "))", "block"), ("[[", "]]", "page")] {
        let mut rest = text;
        while let Some(start) = rest.find(open) {
            let after = &rest[start + open.len()..];
            let Some(end) = after.find(close) else { break };
            let target = after[..end].trim();
            if !target.is_empty() {
                out.push((target.to_string(), kind));
            }
            rest = &after[end + close.len()..];
        }
    }
    out
}

/// A full, ordered dump of the projected tables. Used to prove that an index built
/// incrementally and an index rebuilt from the log are identical.
/// (id, page_id, parent_id, flavour, position, depth, text)
pub type BlockRow = (String, String, Option<String>, String, i64, i64, String);

#[derive(Debug, PartialEq, Eq)]
pub struct IndexDump {
    pub blocks: Vec<BlockRow>,
    pub props: Vec<(String, String, String)>,
    pub refs: Vec<(String, String, String)>,
    pub db_rows: Vec<(String, String, i64)>,
}

pub(crate) fn dump(conn: &Connection) -> Result<IndexDump> {
    let blocks = conn
        .prepare(
            "SELECT id, page_id, parent_id, flavour, position, depth, text FROM blocks ORDER BY id",
        )?
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<std::result::Result<_, _>>()?;
    let props = conn
        .prepare("SELECT block_id, key, value FROM props ORDER BY block_id, key")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<_, _>>()?;
    let refs = conn
        .prepare("SELECT src_block, target, kind FROM refs ORDER BY src_block, target, kind")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<_, _>>()?;
    let db_rows = conn
        .prepare(
            "SELECT database_id, row_id, position FROM db_rows ORDER BY database_id, position",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(IndexDump {
        blocks,
        props,
        refs,
        db_rows,
    })
}
