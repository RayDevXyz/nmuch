//! BrainWaves core: block model, yrs persistence, SQLite index.
//!
//! - [`schema`]: the page layout inside a Y.Doc (the contract with the editor).
//! - [`doc`]: block operations on a Y.Doc, and reading it back as plain data.
//! - `store`: the SQLite update log (the source of truth).
//! - [`index`]: the SQL projection (`pages`, `blocks`, `props`, `refs`, `tags`), rebuildable.
//! - [`query`]: read queries over the index.
//! - [`database`] + [`db_query`]: databases (columns, views, rows, relations, rollups).
//! - [`widgets`]: widget definitions and the access-checked widget data API.
//! - [`Core`]: the single writer that ties them together.
//!
//! See `docs/design/spike-01-block-model.md` and `docs/design/phase-02-editor.md`.

pub mod azgaar;
pub mod burrow;
pub mod core;
pub mod course;
pub mod database;
pub mod db_query;
pub mod dnd;
pub mod doc;
pub mod error;
pub mod events;
pub mod index;
pub mod modules;
pub mod para;
pub mod query;
pub mod schema;
mod store;
pub mod surface;
pub mod sync;
pub mod widgets;

pub use crate::core::{Core, RebuildReport};
pub use crate::database::{
    DatabaseDef, Filter, FilterOp, NewRelation, PropType, Property, RelationConfig, RollupConfig,
    RollupFn, SelectOption, Sort, View, ViewKind,
};
pub use crate::db_query::{DatabaseResult, Group, Row, RowRef};
pub use crate::doc::{BlockTxn, Inline, NewBlock, RefKind, XNode};
pub use crate::error::{Error, Result};
pub use crate::events::{Event, Origin};
pub use crate::sync::{Changes, Cursor};
pub use crate::index::IndexDump;
pub use crate::schema::{
    node, BlockId, BlockSnapshot, PageId, PageKind, PageMeta, PageMetaPatch, PageSnapshot,
};
pub use crate::widgets::{
    Access, Binding, FieldSpec, Manifest, SlotSpec, WidgetDef, WidgetQuery, WidgetResult,
};
