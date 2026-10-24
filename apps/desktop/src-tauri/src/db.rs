//! SQLite persistence. Pages and blocks are ordered by fractional-index
//! `sort_key` strings, so a single block can move without renumbering others.
//! `links` and `tags` are derived indexes rewritten whenever a block is saved.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS pages (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT,
    title       TEXT NOT NULL DEFAULT '',
    icon        TEXT NOT NULL DEFAULT '',
    sort_key    TEXT NOT NULL,
    favorite    INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    trashed_at  INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
    id        TEXT PRIMARY KEY,
    page_id   TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    type      TEXT NOT NULL,
    text      TEXT NOT NULL DEFAULT '',
    plain     TEXT NOT NULL DEFAULT '',
    props     TEXT NOT NULL DEFAULT '{}',
    sort_key  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS blocks_page ON blocks(page_id, sort_key);
CREATE TABLE IF NOT EXISTS links (
    block_id   TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    page_id    TEXT NOT NULL,
    target_id  TEXT NOT NULL,
    PRIMARY KEY (block_id, target_id)
);
CREATE INDEX IF NOT EXISTS links_target ON links(target_id);
CREATE TABLE IF NOT EXISTS tags (
    block_id  TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    page_id   TEXT NOT NULL,
    tag       TEXT NOT NULL,
    PRIMARY KEY (block_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
"#;

pub struct Db {
    conn: Mutex<Connection>,
    pub path: PathBuf,
}

impl Db {
    pub fn open(path: PathBuf) -> rusqlite::Result<Self> {
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn with<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        f(&mut conn).map_err(|e| e.to_string())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub icon: String,
    pub key: String,
    pub favorite: bool,
    pub archived: bool,
    pub trashed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: String,
    pub page_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub text: String,
    pub props: serde_json::Value,
    pub key: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlockWrite {
    pub id: String,
    pub page_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub text: String,
    pub props: serde_json::Value,
    pub key: String,
    pub plain: String,
    pub links: Vec<String>,
    pub tags: Vec<String>,
}

/// A block in another page that references a page (backlink or mention).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Ref {
    pub page_id: String,
    pub block_id: String,
    pub text: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub source: String,
    pub target: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub page_id: String,
    pub block_id: Option<String>,
    pub text: String,
}

pub fn list_pages(c: &mut Connection) -> rusqlite::Result<Vec<Page>> {
    let mut stmt = c.prepare(
        "SELECT id, parent_id, title, icon, sort_key, favorite, archived, trashed_at, created_at, updated_at
         FROM pages ORDER BY sort_key",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Page {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            title: r.get(2)?,
            icon: r.get(3)?,
            key: r.get(4)?,
            favorite: r.get(5)?,
            archived: r.get(6)?,
            trashed_at: r.get(7)?,
            created_at: r.get(8)?,
            updated_at: r.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_page(c: &mut Connection, p: &Page) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO pages (id, parent_id, title, icon, sort_key, favorite, archived, trashed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            parent_id = excluded.parent_id, title = excluded.title, icon = excluded.icon,
            sort_key = excluded.sort_key, favorite = excluded.favorite, archived = excluded.archived,
            trashed_at = excluded.trashed_at, updated_at = excluded.updated_at",
        params![
            p.id,
            p.parent_id,
            p.title,
            p.icon,
            p.key,
            p.favorite,
            p.archived,
            p.trashed_at,
            p.created_at,
            p.updated_at
        ],
    )?;
    Ok(())
}

pub fn delete_pages(c: &mut Connection, ids: &[String]) -> rusqlite::Result<()> {
    let tx = c.transaction()?;
    for id in ids {
        // blocks cascade, and links/tags cascade from blocks
        tx.execute("DELETE FROM pages WHERE id = ?1", params![id])?;
    }
    tx.commit()
}

fn parse_props(s: String) -> serde_json::Value {
    serde_json::from_str(&s).unwrap_or_else(|_| serde_json::json!({}))
}

pub fn get_blocks(c: &mut Connection, page_id: &str) -> rusqlite::Result<Vec<Block>> {
    let mut stmt = c.prepare(
        "SELECT id, page_id, type, text, props, sort_key FROM blocks
         WHERE page_id = ?1 ORDER BY sort_key",
    )?;
    let rows = stmt.query_map(params![page_id], |r| {
        Ok(Block {
            id: r.get(0)?,
            page_id: r.get(1)?,
            kind: r.get(2)?,
            text: r.get(3)?,
            props: parse_props(r.get(4)?),
            key: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn save_blocks(
    c: &mut Connection,
    page_id: &str,
    writes: &[BlockWrite],
    deletes: &[String],
    updated_at: i64,
) -> rusqlite::Result<()> {
    let tx = c.transaction()?;
    for id in deletes {
        tx.execute("DELETE FROM blocks WHERE id = ?1", params![id])?;
    }
    for b in writes {
        tx.execute(
            "INSERT INTO blocks (id, page_id, type, text, plain, props, sort_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                page_id = excluded.page_id, type = excluded.type, text = excluded.text,
                plain = excluded.plain, props = excluded.props, sort_key = excluded.sort_key",
            params![
                b.id,
                b.page_id,
                b.kind,
                b.text,
                b.plain,
                b.props.to_string(),
                b.key
            ],
        )?;
        tx.execute("DELETE FROM links WHERE block_id = ?1", params![b.id])?;
        for target in &b.links {
            tx.execute(
                "INSERT OR IGNORE INTO links (block_id, page_id, target_id) VALUES (?1, ?2, ?3)",
                params![b.id, b.page_id, target],
            )?;
        }
        tx.execute("DELETE FROM tags WHERE block_id = ?1", params![b.id])?;
        for tag in &b.tags {
            tx.execute(
                "INSERT OR IGNORE INTO tags (block_id, page_id, tag) VALUES (?1, ?2, ?3)",
                params![b.id, b.page_id, tag],
            )?;
        }
    }
    tx.execute(
        "UPDATE pages SET updated_at = ?2 WHERE id = ?1",
        params![page_id, updated_at],
    )?;
    tx.commit()
}

fn refs(
    c: &mut Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> rusqlite::Result<Vec<Ref>> {
    let mut stmt = c.prepare(sql)?;
    let rows = stmt.query_map(args, |r| {
        Ok(Ref {
            page_id: r.get(0)?,
            block_id: r.get(1)?,
            text: r.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn backlinks(c: &mut Connection, page_id: &str) -> rusqlite::Result<Vec<Ref>> {
    refs(
        c,
        "SELECT b.page_id, b.id, substr(b.plain, 1, 400) FROM links l
         JOIN blocks b ON b.id = l.block_id
         JOIN pages p ON p.id = b.page_id
         WHERE l.target_id = ?1 AND b.page_id <> ?1 AND p.trashed_at IS NULL
         ORDER BY p.updated_at DESC, b.sort_key",
        params![page_id],
    )
}

fn like_pattern(q: &str) -> String {
    let escaped = q
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{}%", escaped)
}

/// Blocks that contain the page title as plain text without linking to it.
pub fn mentions(c: &mut Connection, page_id: &str, title: &str) -> rusqlite::Result<Vec<Ref>> {
    let title = title.trim();
    if title.chars().count() < 3 {
        return Ok(vec![]);
    }
    let pattern = like_pattern(title);
    refs(
        c,
        "SELECT b.page_id, b.id, substr(b.plain, 1, 400) FROM blocks b
         JOIN pages p ON p.id = b.page_id
         WHERE b.page_id <> ?1 AND p.trashed_at IS NULL
           AND b.plain LIKE ?2 ESCAPE '\\'
           AND NOT EXISTS (SELECT 1 FROM links l WHERE l.block_id = b.id AND l.target_id = ?1)
         ORDER BY p.updated_at DESC LIMIT 50",
        params![page_id, pattern],
    )
}

pub fn links(c: &mut Connection) -> rusqlite::Result<Vec<Link>> {
    let mut stmt = c.prepare("SELECT DISTINCT page_id, target_id FROM links")?;
    let rows = stmt.query_map([], |r| {
        Ok(Link {
            source: r.get(0)?,
            target: r.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn tags(c: &mut Connection) -> rusqlite::Result<Vec<TagCount>> {
    let mut stmt = c.prepare(
        "SELECT t.tag, COUNT(DISTINCT t.page_id) FROM tags t
         JOIN pages p ON p.id = t.page_id
         WHERE p.trashed_at IS NULL
         GROUP BY t.tag ORDER BY t.tag COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(TagCount {
            tag: r.get(0)?,
            count: r.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn pages_with_tag(c: &mut Connection, tag: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = c.prepare("SELECT DISTINCT page_id FROM tags WHERE tag = ?1")?;
    let rows = stmt.query_map(params![tag], |r| r.get(0))?;
    rows.collect()
}

pub fn search(c: &mut Connection, query: &str, limit: i64) -> rusqlite::Result<Vec<Hit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let pattern = like_pattern(q);
    let mut hits: Vec<Hit> = Vec::new();
    {
        let mut stmt = c.prepare(
            "SELECT id, title FROM pages
             WHERE trashed_at IS NULL AND title LIKE ?1 ESCAPE '\\'
             ORDER BY updated_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |r| {
            Ok(Hit {
                page_id: r.get(0)?,
                block_id: None,
                text: r.get(1)?,
            })
        })?;
        for h in rows {
            hits.push(h?);
        }
    }
    {
        let mut stmt = c.prepare(
            "SELECT b.page_id, b.id, substr(b.plain, 1, 2000) FROM blocks b
             JOIN pages p ON p.id = b.page_id
             WHERE p.trashed_at IS NULL AND b.plain LIKE ?1 ESCAPE '\\'
             ORDER BY p.updated_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |r| {
            Ok(Hit {
                page_id: r.get(0)?,
                block_id: r.get(1)?,
                text: r.get(2)?,
            })
        })?;
        for h in rows {
            hits.push(h?);
        }
    }
    Ok(hits)
}

#[allow(dead_code)]
pub fn page_exists(c: &mut Connection, id: &str) -> rusqlite::Result<bool> {
    c.query_row("SELECT 1 FROM pages WHERE id = ?1", params![id], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
}
