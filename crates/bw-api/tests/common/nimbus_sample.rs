//! Writes a small database in the exact schema of the old Nimbus app (`src-tauri/src/db.rs`
//! before the move to bw-core), covering every block type it had. Used by the import tests
//! and by `cargo run -p bw-api --example nimbus_sample -- <path>` for trying the import by hand.

use rusqlite::{params, Connection};

const NIMBUS_SCHEMA: &str = r#"
CREATE TABLE pages (
    id TEXT PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',
    sort_key TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
    trashed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE blocks (
    id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, type TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '', plain TEXT NOT NULL DEFAULT '', props TEXT NOT NULL DEFAULT '{}', sort_key TEXT NOT NULL
);
CREATE TABLE links (block_id TEXT NOT NULL, page_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY (block_id, target_id));
CREATE TABLE tags (block_id TEXT NOT NULL, page_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (block_id, tag));
"#;

pub const DAY: i64 = 86_400_000;
pub const T0: i64 = 1_760_000_000_000; // Oct 2025

/// (id, parent, title, icon, key, favorite, archived, trashed_at, created_at, updated_at)
type P = (
    &'static str,
    Option<&'static str>,
    &'static str,
    &'static str,
    &'static str,
    bool,
    bool,
    Option<i64>,
    i64,
    i64,
);

pub const PAGES: [P; 4] = [
    (
        "n-journal",
        None,
        "Journal",
        "📓",
        "a",
        true,
        false,
        None,
        T0,
        T0 + 30 * DAY,
    ),
    (
        "n-course",
        None,
        "Rust course",
        "🦀",
        "b",
        false,
        false,
        None,
        T0 + DAY,
        T0 + 20 * DAY,
    ),
    (
        "n-week1",
        Some("n-course"),
        "Week 1",
        "",
        "a",
        false,
        true,
        None,
        T0 + 2 * DAY,
        T0 + 3 * DAY,
    ),
    (
        "n-old",
        None,
        "Old draft",
        "",
        "c",
        false,
        false,
        Some(T0 + 40 * DAY),
        T0,
        T0 + 5 * DAY,
    ),
];

const PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

pub fn blocks() -> Vec<(&'static str, &'static str, &'static str, String, String)> {
    let link = |id: &str, t: &str| {
        format!(r#"<a class="page-link" data-page="{id}" contenteditable="false">{t}</a>"#)
    };
    vec![
        // (block id, page id, type, text, props json)
        ("b1", "n-journal", "h1", "Monday".into(), "{}".into()),
        ("b2", "n-journal", "text", format!("Worked on {} today. <b>Bold</b>, <i>italic</i>, <u>under</u>, <s>gone</s>, <code>code</code> and <a href=\"https://example.com\">a link</a>.<br>Second line #daily", link("n-course", "Rust course")), "{}".into()),
        ("b3", "n-journal", "callout", "<b>Remember</b><br>Drink water".into(), r#"{"icon":"💧"}"#.into()),
        ("b4", "n-journal", "bullet", "Top level".into(), "{}".into()),
        ("b5", "n-journal", "bullet", "Indented once".into(), r#"{"indent":1}"#.into()),
        ("b6", "n-journal", "bullet", "Back to top".into(), "{}".into()),
        ("b7", "n-journal", "numbered", "First".into(), "{}".into()),
        ("b8", "n-journal", "numbered", "Second".into(), "{}".into()),
        ("b9", "n-journal", "todo", "Done thing".into(), r#"{"checked":true}"#.into()),
        ("b10", "n-journal", "todo", "Open thing".into(), "{}".into()),
        ("b11", "n-journal", "quote", "A quote".into(), "{}".into()),
        ("b12", "n-journal", "code", "fn main() {\n    println!(\"<hi>\");\n}".into(), r#"{"lang":"rust"}"#.into()),
        ("b13", "n-journal", "divider", "".into(), "{}".into()),
        ("b14", "n-journal", "image", "".into(), format!(r#"{{"src":"{PNG}","caption":"A pixel"}}"#)),
        ("b15", "n-journal", "page", "".into(), r#"{"pageId":"n-course"}"#.into()),
        ("b16", "n-journal", "h2", "Heading 2".into(), "{}".into()),
        ("b17", "n-journal", "h3", "Heading 3".into(), "{}".into()),
        ("c1", "n-course", "text", "Lessons live in sub-pages. #rust".into(), "{}".into()),
        ("c2", "n-course", "page", "".into(), r#"{"pageId":"n-week1"}"#.into()),
        ("w1", "n-week1", "todo", "Ownership".into(), r#"{"checked":true}"#.into()),
        ("o1", "n-old", "text", "Something I threw away".into(), "{}".into()),
        // "n-old" has a block; the page "Week 1" has one; a page with no blocks is covered by none.
    ]
}

pub fn write(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(NIMBUS_SCHEMA).unwrap();
    for (id, parent, title, icon, key, fav, arch, trashed, created, updated) in PAGES {
        conn.execute(
            "INSERT INTO pages VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, parent, title, icon, key, fav, arch, trashed, created, updated],
        )
        .unwrap();
    }
    for (i, (id, page, kind, text, props)) in blocks().into_iter().enumerate() {
        conn.execute(
            "INSERT INTO blocks(id, page_id, type, text, props, sort_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, page, kind, text, props, format!("a{i:03}")],
        )
        .unwrap();
    }
}
