//! The block schema: the contract between the core, the index and every renderer.
//!
//! One Y.Doc per page. Inside it:
//!
//! ```text
//! Y.Doc (one per page, page_id == id of the root block)
//! ├── "meta":   Y.Map { "root": <page_id>, "schema": 1 }
//! └── "blocks": Y.Map<block_id, Y.Map {
//!         "id":       String
//!         "flavour":  String            // "page", "paragraph", "heading", "database", ...
//!         "parent":   String | Null     // Null only for the root (page) block
//!         "children": Y.Array<String>   // ordered child ids
//!         "props":    Y.Map<String, Any>// namespaced keys, e.g. "course.progress"
//!         "text":     Y.Text            // the block's text (title for pages)
//!     }>
//! ```
//!
//! Blocks are stored flat in `blocks` and linked by id. The tree shape lives in
//! each block's `children` array; `parent` is a back pointer for fast lookups.

use std::collections::BTreeMap;

pub type BlockId = String;
pub type PageId = String;

/// Version of the layout above, stored in `meta.schema`.
pub const SCHEMA_VERSION: i64 = 1;

/// Names of the root types and fields inside a page's Y.Doc.
pub mod keys {
    pub const BLOCKS: &str = "blocks";
    pub const META: &str = "meta";
    pub const META_ROOT: &str = "root";
    pub const META_SCHEMA: &str = "schema";

    pub const ID: &str = "id";
    pub const FLAVOUR: &str = "flavour";
    pub const PARENT: &str = "parent";
    pub const CHILDREN: &str = "children";
    pub const PROPS: &str = "props";
    pub const TEXT: &str = "text";
}

/// Built-in block flavours. Flavours are plain strings so modules can add their own
/// without changing the core.
pub mod flavour {
    pub const PAGE: &str = "page";
    pub const PARAGRAPH: &str = "paragraph";
    pub const HEADING: &str = "heading";
    pub const TODO: &str = "todo";
    pub const CODE: &str = "code";
    /// A database is a block with a schema; its children are its rows.
    pub const DATABASE: &str = "database";
}

/// A plain-data, read-only view of one block, produced from the Y.Doc.
/// This is what the indexer projects into SQLite.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockSnapshot {
    pub id: BlockId,
    pub page_id: PageId,
    pub parent: Option<BlockId>,
    pub flavour: String,
    /// Index inside the parent's `children` array (0 for the root).
    pub position: u32,
    /// Distance from the root (0 for the root).
    pub depth: u32,
    pub text: String,
    pub props: BTreeMap<String, serde_json::Value>,
}

/// A whole page, blocks listed in document order (depth-first, pre-order).
#[derive(Debug, Clone, PartialEq)]
pub struct PageSnapshot {
    pub page_id: PageId,
    pub blocks: Vec<BlockSnapshot>,
}

impl PageSnapshot {
    pub fn get(&self, id: &str) -> Option<&BlockSnapshot> {
        self.blocks.iter().find(|b| b.id == id)
    }

    pub fn root(&self) -> &BlockSnapshot {
        &self.blocks[0]
    }
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
