//! Read queries over the index. These never touch a Y.Doc, so they are cheap and work for
//! pages that aren't open anywhere.
//!
//! The shapes match what the app shell expects (`apps/desktop/src/lib/types.ts`).

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::core::Core;
use crate::error::Result;
use crate::index::REF_MARK;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRow {
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

/// A block in another page that references a page (backlink or mention).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefHit {
    pub page_id: String,
    pub block_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub page_id: String,
    pub block_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Link {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

/// What an inline block reference points at.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockInfo {
    pub id: String,
    pub page_id: String,
    pub flavour: String,
    pub text: String,
}

/// Content blocks only: not the page row, not notes.
const CONTENT: &str = "b.flavour NOT IN ('page', 'note')";

fn like_pattern(q: &str) -> String {
    let escaped = q
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

impl Core {
    pub fn list_pages(&self) -> Result<Vec<PageRow>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, parent_id, title, icon, sort_key, favorite, archived, trashed_at, created_at, updated_at
             FROM page_meta ORDER BY sort_key, id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PageRow {
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
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    /// Blocks in other live pages that link to `page_id`, or to a block inside it.
    pub fn backlinks(&self, page_id: &str) -> Result<Vec<RefHit>> {
        let sql = format!(
            "SELECT DISTINCT b.page_id, b.id, b.text, p.updated_at, b.position FROM refs r
             JOIN blocks b ON b.id = r.src_block
             JOIN page_meta p ON p.id = b.page_id
             WHERE b.page_id <> ?1 AND p.trashed_at IS NULL AND {CONTENT}
               AND ((r.kind = 'page' AND r.target = ?1)
                 OR (r.kind = 'block' AND r.target IN (SELECT id FROM blocks WHERE page_id = ?1)))
             ORDER BY p.updated_at DESC, b.page_id, b.position"
        );
        self.ref_hits(&sql, params![page_id])
    }

    /// Blocks in other live pages that contain the page title as plain text but don't link it.
    pub fn mentions(&self, page_id: &str, title: &str) -> Result<Vec<RefHit>> {
        let title = title.trim();
        if title.chars().count() < 3 {
            return Ok(vec![]);
        }
        let sql = format!(
            "SELECT b.page_id, b.id, b.text FROM blocks b
             JOIN page_meta p ON p.id = b.page_id
             WHERE b.page_id <> ?1 AND p.trashed_at IS NULL AND {CONTENT}
               AND b.text LIKE ?2 ESCAPE '\\'
               AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.src_block = b.id AND r.target = ?1)
             ORDER BY p.updated_at DESC LIMIT 50"
        );
        self.ref_hits(&sql, params![page_id, like_pattern(title)])
    }

    /// Page-to-page edges for the graph (block refs count as links to the block's page).
    pub fn links(&self) -> Result<Vec<Link>> {
        let mut stmt = self.conn().prepare(
            "SELECT DISTINCT source, dest FROM (
                SELECT r.page_id AS source, CASE r.kind WHEN 'block' THEN tb.page_id ELSE r.target END AS dest
                FROM refs r LEFT JOIN blocks tb ON r.kind = 'block' AND tb.id = r.target
             ) WHERE dest IS NOT NULL AND dest <> source
             ORDER BY 1, 2",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Link {
                    source: r.get(0)?,
                    target: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    pub fn tags(&self) -> Result<Vec<TagCount>> {
        let mut stmt = self.conn().prepare(
            "SELECT t.tag, COUNT(DISTINCT t.page_id) FROM tags t
             JOIN page_meta p ON p.id = t.page_id
             WHERE p.trashed_at IS NULL
             GROUP BY t.tag ORDER BY t.tag COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TagCount {
                    tag: r.get(0)?,
                    count: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    pub fn pages_with_tag(&self, tag: &str) -> Result<Vec<String>> {
        let mut stmt = self
            .conn()
            .prepare("SELECT DISTINCT page_id FROM tags WHERE tag = ?1 ORDER BY page_id")?;
        let rows = stmt
            .query_map([tag.to_lowercase()], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    /// Page titles first, then matching blocks. Trashed pages are excluded.
    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<Hit>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }
        let pattern = like_pattern(q);
        let conn = self.conn();
        let mut hits: Vec<Hit> = conn
            .prepare(
                "SELECT id, title FROM page_meta WHERE trashed_at IS NULL AND title LIKE ?1 ESCAPE '\\'
                 ORDER BY updated_at DESC LIMIT ?2",
            )?
            .query_map(params![pattern, limit], |r| Ok(Hit { page_id: r.get(0)?, block_id: None, text: r.get(1)? }))?
            .collect::<std::result::Result<_, _>>()?;
        let blocks: Vec<(String, String, String)> = conn
            .prepare(&format!(
                "SELECT b.page_id, b.id, b.text FROM blocks b JOIN page_meta p ON p.id = b.page_id
                 WHERE p.trashed_at IS NULL AND {CONTENT} AND b.text LIKE ?1 ESCAPE '\\'
                 ORDER BY p.updated_at DESC, b.position LIMIT ?2"
            ))?
            .query_map(params![pattern, limit], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?
            .collect::<std::result::Result<_, _>>()?;
        for (page_id, block_id, text) in blocks {
            let text = self.render_text(&block_id, &text)?;
            hits.push(Hit {
                page_id,
                block_id: Some(block_id),
                text,
            });
        }
        Ok(hits)
    }

    /// Look up blocks by id (for rendering inline block references).
    pub fn block_infos(&self, ids: &[String]) -> Result<Vec<BlockInfo>> {
        let mut out = Vec::new();
        let mut stmt = self
            .conn()
            .prepare("SELECT id, page_id, flavour, text FROM blocks WHERE id = ?1")?;
        for id in ids {
            let row = stmt.query_row([id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            });
            if let Ok((id, page_id, flavour, text)) = row {
                let text = self.render_text(&id, &text)?;
                out.push(BlockInfo {
                    id,
                    page_id,
                    flavour,
                    text,
                });
            }
        }
        Ok(out)
    }

    fn ref_hits(&self, sql: &str, args: impl rusqlite::Params) -> Result<Vec<RefHit>> {
        let rows: Vec<(String, String, String)> = self
            .conn()
            .prepare(sql)?
            .query_map(args, |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<_, _>>()?;
        rows.into_iter()
            .map(|(page_id, block_id, text)| {
                let text: String = self
                    .render_text(&block_id, &text)?
                    .chars()
                    .take(400)
                    .collect();
                Ok(RefHit {
                    page_id,
                    block_id,
                    text,
                })
            })
            .collect()
    }

    /// Replace each inline-ref marker in `text` with the referenced page title or block text.
    pub fn render_text(&self, block_id: &str, text: &str) -> Result<String> {
        if !text.contains(REF_MARK) {
            return Ok(text.to_string());
        }
        let targets = ref_targets(self.conn(), block_id)?;
        let mut it = targets.into_iter();
        Ok(text
            .chars()
            .map(|c| {
                if c == REF_MARK {
                    it.next().unwrap_or_default()
                } else {
                    c.to_string()
                }
            })
            .collect())
    }
}

/// Titles for the inline refs of one block, in document order.
fn ref_targets(conn: &Connection, block_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(p.title, tb.text, '') FROM refs r
         LEFT JOIN page_meta p ON r.kind = 'page' AND p.id = r.target
         LEFT JOIN blocks tb ON r.kind = 'block' AND tb.id = r.target
         WHERE r.src_block = ?1 ORDER BY r.ord",
    )?;
    let rows = stmt
        .query_map([block_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|t| {
            if t.is_empty() {
                "Untitled".to_string()
            } else {
                t.replace(REF_MARK, "")
            }
        })
        .collect();
    Ok(rows)
}
