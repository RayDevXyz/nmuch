//! Read-only access to a database written by the old Nimbus app (`nimbus.db`).
//!
//! The import itself happens in the frontend, which already knows how to turn Nimbus blocks
//! (inline HTML + props) into Tiptap content (`apps/desktop/src/lib/convert.ts`). This module
//! only reads the old file; it never writes to it.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NimbusPage {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NimbusBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub text: String,
    pub props: Value,
    pub key: String,
}

fn open(path: &Path) -> Result<Connection, String> {
    if !path.is_file() {
        return Err(format!("no file at {}", path.display()));
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let tables: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('pages', 'blocks')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let nimbus = conn
        .prepare("SELECT sort_key, trashed_at FROM pages LIMIT 0")
        .is_ok();
    if tables != 2 || !nimbus {
        return Err(format!("{} is not a Nimbus database", path.display()));
    }
    Ok(conn)
}

/// All pages, parents before children is not guaranteed; the importer keeps ids, so order
/// doesn't matter.
pub fn pages(path: &Path) -> Result<Vec<NimbusPage>, String> {
    let conn = open(path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, title, icon, sort_key, favorite, archived, trashed_at, created_at, updated_at
             FROM pages ORDER BY sort_key, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(NimbusPage {
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
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// The blocks of one page, in order. Fetched per page so a page full of images doesn't
/// have to travel together with every other page.
pub fn blocks(path: &Path, page_id: &str) -> Result<Vec<NimbusBlock>, String> {
    let conn = open(path)?;
    let mut stmt = conn
        .prepare("SELECT id, type, text, props, sort_key FROM blocks WHERE page_id = ?1 ORDER BY sort_key, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([page_id], |r| {
            let props: String = r.get(3)?;
            Ok(NimbusBlock {
                id: r.get(0)?,
                kind: r.get(1)?,
                text: r.get(2)?,
                props: serde_json::from_str(&props).unwrap_or(Value::Object(Default::default())),
                key: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
