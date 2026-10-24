//! BrainWaves core: block model, yrs persistence, SQLite index.
//!
//! - [`schema`]: the page layout inside a Y.Doc (the contract with the editor).
//! - [`doc`]: block operations on a Y.Doc, and reading it back as plain data.
//! - `store`: the SQLite update log (the source of truth).
//! - [`index`]: the SQL projection (`pages`, `blocks`, `props`, `refs`, `tags`), rebuildable.
//! - [`query`]: read queries over the index.
//! - [`Core`]: the single writer that ties them together.
//!
//! See `docs/spike-01-block-model.md` and `docs/phase-02-editor.md`.

pub mod core;
pub mod doc;
pub mod error;
pub mod events;
pub mod index;
pub mod query;
pub mod schema;
mod store;

pub use crate::core::{Core, RebuildReport};
pub use crate::doc::{BlockTxn, Inline, NewBlock, RefKind, XNode};
pub use crate::error::{Error, Result};
pub use crate::events::{Event, Origin};
pub use crate::index::IndexDump;
pub use crate::schema::{
    node, BlockId, BlockSnapshot, PageId, PageMeta, PageMetaPatch, PageSnapshot,
};
