//! The page schema: the contract between the Rust core, the index and the editor.
//!
//! One Y.Doc per page. Since schema 2 a page's text lives in one or more **notes**, each a
//! `Y.XmlFragment` that a Tiptap editor binds to through y-prosemirror:
//!
//! ```text
//! Y.Doc (one per page)
//! ├── "page":    Y.Map   { id, schema, title, icon, parent, key, favorite, archived, trashedAt }
//! ├── "notes":   Y.Map<note_id, Y.Map {
//! │                  id:      String
//! │                  order:   String          fractional key; doc mode shows notes in this order
//! │                  xywh:    [x, y, w, h]?   position on the edgeless canvas (later)
//! │                  content: Y.XmlFragment   the ProseMirror document of this note
//! │              }>
//! ├── "props":   Y.Map<block_id, Y.Map<key, Any>>   module data on any block, e.g. "course.progress"
//! ├── "surface": Y.Map   reserved for edgeless shapes, arrows and frames
//! │
//! │   only on database pages (page.kind = "database"), see `database.rs`:
//! ├── "dbProperties": Y.Map<property_id, Any>   one JSON object per column
//! └── "dbViews":      Y.Map<view_id, Any>       one JSON object per saved view
//! ```
//!
//! A database **row** is an ordinary page with `page.database` set to its database's id; its
//! cell values are module props on the page itself, keyed `db.<property_id>`.
//!
//! Inside a note's fragment, every block is a `Y.XmlElement` whose tag is the ProseMirror node
//! name (`paragraph`, `heading`, `taskItem`, ...) and whose attributes are the node's attrs.
//! Every block node carries a stable `id` attribute. Text is stored in `Y.XmlText` children
//! (marks as formatting attributes); inline nodes such as `ref` are `Y.XmlElement`s without an id.
//! The [`node`] module lists the node names; `packages/editor/src/schema.ts` must agree.

use std::collections::BTreeMap;

pub type BlockId = String;
pub type PageId = String;

/// Version of the layout above, stored in `page.schema`.
pub const SCHEMA_VERSION: i64 = 2;

/// Names of the root types and map fields inside a page's Y.Doc.
pub mod keys {
    pub const PAGE: &str = "page";
    pub const NOTES: &str = "notes";
    pub const PROPS: &str = "props";
    pub const SURFACE: &str = "surface";

    pub const ID: &str = "id";
    pub const SCHEMA: &str = "schema";

    pub const NOTE_ORDER: &str = "order";
    pub const NOTE_XYWH: &str = "xywh";
    pub const NOTE_CONTENT: &str = "content";

    pub const DB_PROPERTIES: &str = "dbProperties";
    pub const DB_VIEWS: &str = "dbViews";
    /// Prefix of a row's cell values in its `props`: `db.<property_id>`.
    pub const DB_VALUE_PREFIX: &str = "db.";
}

/// ProseMirror node names, shared with the Tiptap schema in `packages/editor`.
pub mod node {
    pub const PARAGRAPH: &str = "paragraph";
    pub const HEADING: &str = "heading";
    pub const BLOCKQUOTE: &str = "blockquote";
    pub const CALLOUT: &str = "callout";
    pub const BULLET_LIST: &str = "bulletList";
    pub const ORDERED_LIST: &str = "orderedList";
    pub const LIST_ITEM: &str = "listItem";
    pub const TASK_LIST: &str = "taskList";
    pub const TASK_ITEM: &str = "taskItem";
    pub const CODE_BLOCK: &str = "codeBlock";
    pub const HORIZONTAL_RULE: &str = "horizontalRule";
    /// An inline view of a database. attrs: `databaseId`, `viewId`.
    pub const DATABASE: &str = "database";
    pub const IMAGE: &str = "image";
    /// A sub-page embedded as a block. attrs: `pageId`.
    pub const PAGE_LINK: &str = "pageLink";

    /// Inline reference. attrs: `kind` ("page" | "block"), `target` (id).
    pub const REF: &str = "ref";
    pub const HARD_BREAK: &str = "hardBreak";

    /// Synthetic flavours used in the index for the page itself and its notes.
    pub const PAGE: &str = "page";
    pub const NOTE: &str = "note";

    pub const INLINE: [&str; 2] = [REF, HARD_BREAK];

    /// Blocks whose content is inline text.
    pub const TEXTBLOCKS: [&str; 4] = [PARAGRAPH, HEADING, CODE_BLOCK, CALLOUT];

    pub fn is_inline(tag: &str) -> bool {
        INLINE.contains(&tag)
    }

    /// Mirror of the ProseMirror content expressions: may `child` appear inside `parent`?
    /// `parent == NOTE` means the top level of a note.
    pub fn allows(parent: &str, child: &str) -> bool {
        let block = !is_inline(child) && child != LIST_ITEM && child != TASK_ITEM;
        match parent {
            NOTE | BLOCKQUOTE | LIST_ITEM | TASK_ITEM => block,
            BULLET_LIST | ORDERED_LIST => child == LIST_ITEM,
            TASK_LIST => child == TASK_ITEM,
            _ => false,
        }
    }
}

/// What a page is. A database page holds columns and views; its rows are pages too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageKind {
    #[default]
    Page,
    Database,
}

impl PageKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PageKind::Page => "page",
            PageKind::Database => "database",
        }
    }
}

/// Page metadata, kept in the page's `page` map (last writer wins per field).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PageMeta {
    pub kind: PageKind,
    /// Set on database rows: the database this page is a row of.
    pub database_id: Option<PageId>,
    pub title: String,
    pub icon: String,
    pub parent_id: Option<PageId>,
    /// Fractional sort key among siblings.
    pub key: String,
    pub favorite: bool,
    pub archived: bool,
    pub trashed_at: Option<i64>,
}

/// A partial update of [`PageMeta`]: only fields that are `Some` change.
/// `parent_id: Some(None)` moves the page to the top level, likewise for `trashed_at`.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PageMetaPatch {
    pub kind: Option<PageKind>,
    #[serde(deserialize_with = "double_option")]
    pub database_id: Option<Option<PageId>>,
    pub title: Option<String>,
    pub icon: Option<String>,
    #[serde(deserialize_with = "double_option")]
    pub parent_id: Option<Option<PageId>>,
    pub key: Option<String>,
    pub favorite: Option<bool>,
    pub archived: Option<bool>,
    #[serde(deserialize_with = "double_option")]
    pub trashed_at: Option<Option<i64>>,
}

/// Distinguish a missing field (`None`) from an explicit `null` (`Some(None)`).
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    Option::<T>::deserialize(de).map(Some)
}

impl PageMetaPatch {
    pub fn from_meta(m: &PageMeta) -> Self {
        Self {
            kind: Some(m.kind),
            database_id: Some(m.database_id.clone()),
            title: Some(m.title.clone()),
            icon: Some(m.icon.clone()),
            parent_id: Some(m.parent_id.clone()),
            key: Some(m.key.clone()),
            favorite: Some(m.favorite),
            archived: Some(m.archived),
            trashed_at: Some(m.trashed_at),
        }
    }
}

/// A plain-data, read-only view of one block, produced from the Y.Doc.
/// This is what the indexer projects into SQLite.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockSnapshot {
    pub id: BlockId,
    pub page_id: PageId,
    pub parent: Option<BlockId>,
    /// The note this block lives in (`None` for the page and the notes themselves).
    pub note_id: Option<String>,
    /// ProseMirror node name, or `page` / `note`.
    pub flavour: String,
    /// Index among the parent's block children.
    pub position: u32,
    pub depth: u32,
    /// Plain text of the block's own inline content (not its child blocks).
    pub text: String,
    /// Node attributes other than `id`, e.g. heading `level`, task `checked`.
    pub attrs: BTreeMap<String, serde_json::Value>,
    /// Module properties from the page's `props` map.
    pub props: BTreeMap<String, serde_json::Value>,
    /// Outgoing references: (target id, kind), kind being "page" or "block".
    pub refs: Vec<(String, String)>,
}

/// A whole page, blocks listed in document order (page, then each note depth-first).
#[derive(Debug, Clone, PartialEq)]
pub struct PageSnapshot {
    pub page_id: PageId,
    pub meta: PageMeta,
    pub blocks: Vec<BlockSnapshot>,
    /// Columns and views, for database pages.
    pub database: Option<crate::database::DatabaseDef>,
}

impl PageSnapshot {
    pub fn get(&self, id: &str) -> Option<&BlockSnapshot> {
        self.blocks.iter().find(|b| b.id == id)
    }

    pub fn root(&self) -> &BlockSnapshot {
        &self.blocks[0]
    }

    pub fn notes(&self) -> impl Iterator<Item = &BlockSnapshot> {
        self.blocks.iter().filter(|b| b.flavour == node::NOTE)
    }

    /// Blocks that are actual note content (no page, no notes).
    pub fn content(&self) -> impl Iterator<Item = &BlockSnapshot> {
        self.blocks.iter().filter(|b| b.note_id.is_some())
    }
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
