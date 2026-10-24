//! BrainWaves core — spike 1: block model + yrs persistence + index rebuild.
//!
//! - [`schema`]: the block layout inside a page's Y.Doc (the contract).
//! - [`doc`]: block operations on a Y.Doc, and reading it back as plain data.
//! - `store`: the SQLite update log (the source of truth).
//! - [`index`]: the SQL projection (`blocks`, `props`, `refs`, `db_rows`), rebuildable.
//! - [`Core`]: the single writer that ties them together.
//!
//! See `docs/spike-01-block-model.md` for the full write-up.

pub mod core;
pub mod doc;
pub mod error;
pub mod events;
pub mod index;
pub mod schema;
mod store;

pub use crate::core::{Core, RebuildReport};
pub use crate::doc::BlockTxn;
pub use crate::error::{Error, Result};
pub use crate::events::{Event, Origin};
pub use crate::index::IndexDump;
pub use crate::schema::{flavour, BlockId, BlockSnapshot, PageId, PageSnapshot};
