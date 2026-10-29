//! The SQL index: a disposable projection of page snapshots into queryable tables.
//!
//! Every table here can be dropped at any time and rebuilt from the update log with
//! [`crate::Core::rebuild_index`]. Nothing in here is ever read back into a Y.Doc.

use rusqlite::{params, Connection, Transaction};

use crate::error::Result;
use crate::schema::PageSnapshot;

/// Stands in for an inline reference inside `blocks.text`. Query helpers swap it for the
/// target's current title, so renames never leave stale text in the index.
pub const REF_MARK: char = '\u{FFFC}';

/// Bump when the projection's tables or contents change: an index of another version is
/// dropped and rebuilt from the log on open. 3 = databases (`page_meta.kind`/`database_id`).
pub const INDEX_VERSION: i64 = 4;

const CREATE_PROJECTION: &str = r#"
    CREATE TABLE IF NOT EXISTS index_version (v INTEGER NOT NULL);

    CREATE TABLE IF NOT EXISTS page_meta (
        id          TEXT PRIMARY KEY,
        kind        TEXT    NOT NULL,
        database_id TEXT,
        parent_id   TEXT,
        title      TEXT    NOT NULL,
        icon       TEXT    NOT NULL,
        sort_key   TEXT    NOT NULL,
        favorite   INTEGER NOT NULL,
        archived   INTEGER NOT NULL,
        trashed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS page_meta_by_parent ON page_meta(parent_id, sort_key);
    CREATE INDEX IF NOT EXISTS page_meta_by_database ON page_meta(database_id, sort_key);

    -- Every block, plus one row for the page itself and one per note.
    CREATE TABLE IF NOT EXISTS blocks (
        id        TEXT PRIMARY KEY,
        page_id   TEXT    NOT NULL,
        note_id   TEXT,
        parent_id TEXT,
        flavour   TEXT    NOT NULL,
        position  INTEGER NOT NULL,
        depth     INTEGER NOT NULL,
        text      TEXT    NOT NULL,
        attrs     TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS blocks_by_page   ON blocks(page_id);
    CREATE INDEX IF NOT EXISTS blocks_by_parent ON blocks(parent_id, position);

    -- One row per (block, module property). value is JSON; query it with json_extract().
    CREATE TABLE IF NOT EXISTS props (
        block_id TEXT NOT NULL,
        page_id  TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (block_id, key)
    );
    CREATE INDEX IF NOT EXISTS props_by_key ON props(key, value);

    -- Inline refs and sub-page blocks. kind is 'page' or 'block'; ord is the ref's place
    -- in the block's text, matching the order of REF_MARK characters in blocks.text.
    CREATE TABLE IF NOT EXISTS refs (
        src_block TEXT    NOT NULL,
        page_id   TEXT    NOT NULL,
        target    TEXT    NOT NULL,
        kind      TEXT    NOT NULL,
        ord       INTEGER NOT NULL,
        PRIMARY KEY (src_block, ord)
    );
    CREATE INDEX IF NOT EXISTS refs_by_target ON refs(target);

    -- #tags found in block text, lower-cased.
    CREATE TABLE IF NOT EXISTS tags (
        block_id TEXT NOT NULL,
        page_id  TEXT NOT NULL,
        tag      TEXT NOT NULL,
        PRIMARY KEY (block_id, tag)
    );
    CREATE INDEX IF NOT EXISTS tags_by_tag ON tags(tag);

    -- Bookkeeping: the last log entry each page's projection reflects.
    CREATE TABLE IF NOT EXISTS index_state (
        page_id     TEXT PRIMARY KEY,
        indexed_seq INTEGER NOT NULL
    );
"#;

const PROJECTED_TABLES: [&str; 6] = [
    "page_meta",
    "blocks",
    "props",
    "refs",
    "tags",
    "index_state",
];

pub(crate) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(CREATE_PROJECTION)?;
    conn.execute_batch(&format!(
        "DELETE FROM index_version; INSERT INTO index_version(v) VALUES ({INDEX_VERSION});"
    ))?;
    Ok(())
}

/// Drop every projected table, including ones from older index versions.
pub(crate) fn drop_tables(conn: &Connection) -> Result<()> {
    for t in PROJECTED_TABLES
        .iter()
        .chain(["index_version", "db_rows"].iter())
    {
        conn.execute_batch(&format!("DROP TABLE IF EXISTS {t};"))?;
    }
    Ok(())
}

/// On open: an index written by a different version is dropped (the caller then re-projects
/// every page from the log). Returns true if it was dropped.
pub(crate) fn prepare(conn: &Connection) -> Result<bool> {
    use rusqlite::OptionalExtension;
    let has_any: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('page_meta', 'blocks', 'index_state')",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0;
    let version: Option<i64> = conn
        .query_row("SELECT v FROM index_version", [], |r| r.get(0))
        .optional()
        .unwrap_or(None);
    let stale = has_any && version != Some(INDEX_VERSION);
    if stale {
        drop_tables(conn)?;
    }
    create_tables(conn)?;
    Ok(stale)
}

/// Log timestamps the projection needs alongside the snapshot.
pub(crate) struct PageTimes {
    pub created_at: i64,
    pub updated_at: i64,
}

/// Replace everything the index knows about one page with `snap`.
///
/// Delete-and-reinsert the whole page. Inserts use `OR IGNORE` so that a malformed document
/// (say, two blocks sharing an id after a paste) can never make a user's write fail: the
/// first occurrence is indexed and the log still gets the update.
pub(crate) fn project_page(
    tx: &Transaction,
    snap: &PageSnapshot,
    seq: i64,
    times: &PageTimes,
) -> Result<()> {
    clear_page(tx, &snap.page_id)?;
    let m = &snap.meta;
    tx.execute(
        "INSERT INTO page_meta(id, kind, database_id, parent_id, title, icon, sort_key, favorite, archived, trashed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            snap.page_id, m.kind.as_str(), m.database_id, m.parent_id, m.title, m.icon, m.key, m.favorite,
            m.archived, m.trashed_at, times.created_at, times.updated_at
        ],
    )?;

    let mut ins_block = tx.prepare_cached(
        "INSERT OR IGNORE INTO blocks(id, page_id, note_id, parent_id, flavour, position, depth, text, attrs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;
    let mut ins_prop = tx.prepare_cached(
        "INSERT OR IGNORE INTO props(block_id, page_id, key, value) VALUES (?1, ?2, ?3, ?4)",
    )?;
    let mut ins_ref =
        tx.prepare_cached("INSERT OR IGNORE INTO refs(src_block, page_id, target, kind, ord) VALUES (?1, ?2, ?3, ?4, ?5)")?;
    let mut ins_tag = tx
        .prepare_cached("INSERT OR IGNORE INTO tags(block_id, page_id, tag) VALUES (?1, ?2, ?3)")?;

    for b in &snap.blocks {
        let attrs = serde_json::Value::Object(b.attrs.clone().into_iter().collect()).to_string();
        ins_block.execute(params![
            b.id, b.page_id, b.note_id, b.parent, b.flavour, b.position, b.depth, b.text, attrs
        ])?;
        for (k, v) in &b.props {
            ins_prop.execute(params![b.id, b.page_id, k, v.to_string()])?;
        }
        for (ord, (target, kind)) in b.refs.iter().enumerate() {
            ins_ref.execute(params![b.id, b.page_id, target, kind, ord as i64])?;
        }
        if b.note_id.is_some() {
            for tag in extract_tags(&b.text) {
                ins_tag.execute(params![b.id, b.page_id, tag])?;
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

pub(crate) fn clear_page(tx: &Connection, page_id: &str) -> Result<()> {
    tx.execute("DELETE FROM page_meta WHERE id = ?1", [page_id])?;
    for t in ["blocks", "props", "refs", "tags"] {
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

/// `#tags` in plain text: `#` at the start or after whitespace/`(`, then a letter or `_`,
/// then letters, digits, `_`, `-` or `/`. Lower-cased, deduplicated.
pub fn extract_tags(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    for i in 0..chars.len() {
        if chars[i] != '#' || (i > 0 && !(chars[i - 1].is_whitespace() || chars[i - 1] == '(')) {
            continue;
        }
        let Some(&first) = chars.get(i + 1) else {
            continue;
        };
        if !(first.is_alphabetic() || first == '_') {
            continue;
        }
        let tag: String = chars[i + 1..]
            .iter()
            .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '/'))
            .collect::<String>()
            .to_lowercase();
        if !out.contains(&tag) {
            out.push(tag);
        }
    }
    out
}

/// A full, ordered dump of the projected tables. Used to prove that an index built
/// incrementally and an index rebuilt from the log are identical.
#[derive(Debug, PartialEq, Eq)]
pub struct IndexDump {
    pub pages: Vec<Vec<String>>,
    pub blocks: Vec<Vec<String>>,
    pub props: Vec<Vec<String>>,
    pub refs: Vec<Vec<String>>,
    pub tags: Vec<Vec<String>>,
}

pub(crate) fn dump(conn: &Connection) -> Result<IndexDump> {
    let rows = |sql: &str| -> Result<Vec<Vec<String>>> {
        let mut stmt = conn.prepare(sql)?;
        let n = stmt.column_count();
        let out = stmt
            .query_map([], |r| {
                (0..n)
                    .map(|i| {
                        r.get::<_, rusqlite::types::Value>(i)
                            .map(|v| format!("{v:?}"))
                    })
                    .collect::<std::result::Result<Vec<_>, _>>()
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(out)
    };
    Ok(IndexDump {
        // updated_at is when the last update was *written*; a rebuild recomputes it from the
        // log, so it is compared too.
        pages: rows("SELECT * FROM page_meta ORDER BY id")?,
        blocks: rows("SELECT * FROM blocks ORDER BY id")?,
        props: rows("SELECT * FROM props ORDER BY block_id, key")?,
        refs: rows("SELECT * FROM refs ORDER BY src_block, ord")?,
        tags: rows("SELECT * FROM tags ORDER BY block_id, tag")?,
    })
}
