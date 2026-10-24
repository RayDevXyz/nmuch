//! The block model on top of yrs: creating, editing and reading blocks inside a page's Y.Doc.
//!
//! Nothing in this module touches SQLite. It only knows how to turn block operations into
//! Y.Doc changes ([`BlockTxn`]) and how to read a Y.Doc back as plain data ([`snapshot`]).

use std::collections::{BTreeMap, HashSet};

use yrs::types::ToJson;
use yrs::{
    Any, Array, ArrayPrelim, ArrayRef, Doc, GetString, In, Map, MapPrelim, MapRef, Out, ReadTxn,
    Text, TextPrelim, TextRef, Transact, TransactionMut,
};

use crate::error::{Error, Result};
use crate::schema::{
    flavour, keys, new_id, BlockId, BlockSnapshot, PageId, PageSnapshot, SCHEMA_VERSION,
};

/// Write the meta map and the root page block into an empty doc.
pub(crate) fn init_page(doc: &Doc, page_id: &str, title: &str) {
    let meta = doc.get_or_insert_map(keys::META);
    let blocks = doc.get_or_insert_map(keys::BLOCKS);
    let mut txn = doc.transact_mut();
    meta.insert(&mut txn, keys::META_ROOT, page_id);
    meta.insert(&mut txn, keys::META_SCHEMA, SCHEMA_VERSION);
    blocks.insert(
        &mut txn,
        page_id,
        new_block_prelim(page_id, flavour::PAGE, None, title),
    );
}

fn new_block_prelim(id: &str, flavour: &str, parent: Option<&str>, text: &str) -> MapPrelim {
    let parent: In = match parent {
        Some(p) => p.into(),
        None => In::Any(Any::Null),
    };
    MapPrelim::from_iter([
        (keys::ID, In::from(id)),
        (keys::FLAVOUR, In::from(flavour)),
        (keys::PARENT, parent),
        (keys::CHILDREN, In::from(ArrayPrelim::default())),
        (keys::PROPS, In::from(MapPrelim::default())),
        (keys::TEXT, In::from(TextPrelim::new(text))),
    ])
}

/// A write transaction over one page's blocks.
///
/// Created by [`crate::Core::transact`]; every change made through it becomes part of a
/// single yrs update, which the core then appends to the log and projects into the index.
pub struct BlockTxn<'a, 'doc> {
    txn: &'a mut TransactionMut<'doc>,
    blocks: MapRef,
    page_id: PageId,
}

impl<'a, 'doc> BlockTxn<'a, 'doc> {
    pub(crate) fn new(txn: &'a mut TransactionMut<'doc>, blocks: MapRef, page_id: PageId) -> Self {
        Self {
            txn,
            blocks,
            page_id,
        }
    }

    pub fn page_id(&self) -> &str {
        &self.page_id
    }

    pub fn exists(&self, id: &str) -> bool {
        self.blocks.contains_key(&*self.txn, id)
    }

    /// Insert a new block under `parent` at `index` (`None` appends). Returns its id.
    pub fn insert_block(
        &mut self,
        parent: &str,
        index: Option<u32>,
        flavour: &str,
        text: &str,
    ) -> Result<BlockId> {
        let id = new_id();
        let children = self.children(parent)?;
        let len = children.len(&*self.txn);
        let index = index.unwrap_or(len);
        if index > len {
            return Err(Error::Invalid(format!(
                "index {index} out of range (len {len})"
            )));
        }
        self.blocks.insert(
            self.txn,
            id.as_str(),
            new_block_prelim(&id, flavour, Some(parent), text),
        );
        children.insert(self.txn, index, id.as_str());
        Ok(id)
    }

    /// Append a block as the last child of `parent`.
    pub fn append(&mut self, parent: &str, flavour: &str, text: &str) -> Result<BlockId> {
        self.insert_block(parent, None, flavour, text)
    }

    /// Replace the whole text of a block.
    pub fn set_text(&mut self, id: &str, value: &str) -> Result<()> {
        let text = self.text(id)?;
        let len = text.len(&*self.txn);
        if len > 0 {
            text.remove_range(self.txn, 0, len);
        }
        text.insert(self.txn, 0, value);
        Ok(())
    }

    /// Insert into a block's text at a character offset (how an editor keystroke arrives).
    pub fn insert_text(&mut self, id: &str, index: u32, chunk: &str) -> Result<()> {
        let text = self.text(id)?;
        if index > text.len(&*self.txn) {
            return Err(Error::Invalid(format!("text index {index} out of range")));
        }
        text.insert(self.txn, index, chunk);
        Ok(())
    }

    pub fn set_flavour(&mut self, id: &str, flavour: &str) -> Result<()> {
        let block = self.block(id)?;
        block.insert(self.txn, keys::FLAVOUR, flavour);
        Ok(())
    }

    /// Set a property. Keys should be namespaced by their owner, e.g. `course.progress`.
    pub fn set_prop(&mut self, id: &str, key: &str, value: serde_json::Value) -> Result<()> {
        let any: Any = serde_json::from_value(value)
            .map_err(|e| Error::Invalid(format!("prop value not representable: {e}")))?;
        let props = self.props(id)?;
        props.insert(self.txn, key, any);
        Ok(())
    }

    pub fn remove_prop(&mut self, id: &str, key: &str) -> Result<()> {
        let props = self.props(id)?;
        props.remove(self.txn, key);
        Ok(())
    }

    /// Move a block (and its subtree) under `new_parent` at `index` (`None` appends).
    pub fn move_block(&mut self, id: &str, new_parent: &str, index: Option<u32>) -> Result<()> {
        if id == self.page_id {
            return Err(Error::Invalid("cannot move the page root".into()));
        }
        if self.subtree(id)?.contains(new_parent) {
            return Err(Error::Invalid("cannot move a block inside itself".into()));
        }
        let new_children = self.children(new_parent)?;
        self.detach(id)?;
        let len = new_children.len(&*self.txn);
        let index = index.unwrap_or(len).min(len);
        new_children.insert(self.txn, index, id);
        self.block(id)?.insert(self.txn, keys::PARENT, new_parent);
        Ok(())
    }

    /// Delete a block and everything below it.
    pub fn delete_block(&mut self, id: &str) -> Result<()> {
        if id == self.page_id {
            return Err(Error::Invalid(
                "cannot delete the page root; delete the page instead".into(),
            ));
        }
        let doomed = self.subtree(id)?;
        self.detach(id)?;
        for b in doomed {
            self.blocks.remove(self.txn, &b);
        }
        Ok(())
    }

    /// Ids of `id` and all of its descendants.
    fn subtree(&self, id: &str) -> Result<HashSet<BlockId>> {
        let mut out = HashSet::new();
        let mut stack = vec![id.to_string()];
        while let Some(cur) = stack.pop() {
            stack.extend(child_ids(&*self.txn, &self.children(&cur)?));
            out.insert(cur);
        }
        Ok(out)
    }

    /// Remove `id` from its parent's `children` array.
    fn detach(&mut self, id: &str) -> Result<()> {
        let parent = parent_of(&*self.txn, &self.block(id)?)
            .ok_or_else(|| Error::Malformed(format!("block {id} has no parent")))?;
        let siblings = self.children(&parent)?;
        let pos = child_ids(&*self.txn, &siblings)
            .iter()
            .position(|c| c == id)
            .ok_or_else(|| {
                Error::Malformed(format!("block {id} missing from parent's children"))
            })?;
        siblings.remove(self.txn, pos as u32);
        Ok(())
    }

    fn block(&self, id: &str) -> Result<MapRef> {
        block_map(&*self.txn, &self.blocks, id)
    }

    fn children(&self, id: &str) -> Result<ArrayRef> {
        match self.block(id)?.get(&*self.txn, keys::CHILDREN) {
            Some(Out::YArray(a)) => Ok(a),
            _ => Err(Error::Malformed(format!(
                "block {id} has no children array"
            ))),
        }
    }

    fn props(&self, id: &str) -> Result<MapRef> {
        match self.block(id)?.get(&*self.txn, keys::PROPS) {
            Some(Out::YMap(m)) => Ok(m),
            _ => Err(Error::Malformed(format!("block {id} has no props map"))),
        }
    }

    fn text(&self, id: &str) -> Result<TextRef> {
        match self.block(id)?.get(&*self.txn, keys::TEXT) {
            Some(Out::YText(t)) => Ok(t),
            _ => Err(Error::Malformed(format!("block {id} has no text"))),
        }
    }
}

fn block_map<T: ReadTxn>(txn: &T, blocks: &MapRef, id: &str) -> Result<MapRef> {
    match blocks.get(txn, id) {
        Some(Out::YMap(m)) => Ok(m),
        Some(_) => Err(Error::Malformed(format!("block {id} is not a map"))),
        None => Err(Error::BlockNotFound(id.to_string())),
    }
}

fn child_ids<T: ReadTxn>(txn: &T, children: &ArrayRef) -> Vec<BlockId> {
    children
        .iter(txn)
        .filter_map(|v| match v {
            Out::Any(Any::String(s)) => Some(s.to_string()),
            _ => None,
        })
        .collect()
}

fn parent_of<T: ReadTxn>(txn: &T, block: &MapRef) -> Option<BlockId> {
    match block.get(txn, keys::PARENT) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

fn string_field<T: ReadTxn>(txn: &T, block: &MapRef, key: &str) -> String {
    match block.get(txn, key) {
        Some(Out::Any(Any::String(s))) => s.to_string(),
        _ => String::new(),
    }
}

/// Read a page's Y.Doc into plain data, blocks in document order.
///
/// Only blocks reachable from the root are returned. A block can become unreachable when two
/// replicas concurrently move or delete around it; such orphans stay in the Y.Doc but are not
/// part of the page (see the spike doc, "Known limits").
pub fn snapshot(doc: &Doc, page_id: &str) -> Result<PageSnapshot> {
    let blocks = doc.get_or_insert_map(keys::BLOCKS);
    let txn = doc.transact();
    if !blocks.contains_key(&txn, page_id) {
        return Err(Error::PageNotFound(page_id.to_string()));
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    // Stack of (id, parent, position, depth); children pushed in reverse to pop in order.
    let mut stack: Vec<(BlockId, Option<BlockId>, u32, u32)> =
        vec![(page_id.to_string(), None, 0, 0)];
    while let Some((id, parent, position, depth)) = stack.pop() {
        if !seen.insert(id.clone()) {
            continue; // same id listed twice (concurrent moves); first occurrence wins
        }
        let Ok(block) = block_map(&txn, &blocks, &id) else {
            continue; // dangling child id (concurrent delete)
        };
        let text = match block.get(&txn, keys::TEXT) {
            Some(Out::YText(t)) => t.get_string(&txn),
            _ => String::new(),
        };
        let mut props = BTreeMap::new();
        if let Some(Out::YMap(p)) = block.get(&txn, keys::PROPS) {
            for (k, v) in p.iter(&txn) {
                let json = serde_json::to_value(v.to_json(&txn))
                    .map_err(|e| Error::Malformed(format!("prop {k}: {e}")))?;
                props.insert(k.to_string(), json);
            }
        }
        if let Some(Out::YArray(children)) = block.get(&txn, keys::CHILDREN) {
            let ids = child_ids(&txn, &children);
            for (i, child) in ids.into_iter().enumerate().rev() {
                stack.push((child, Some(id.clone()), i as u32, depth + 1));
            }
        }
        out.push(BlockSnapshot {
            flavour: string_field(&txn, &block, keys::FLAVOUR),
            id,
            page_id: page_id.to_string(),
            parent,
            position,
            depth,
            text,
            props,
        });
    }
    Ok(PageSnapshot {
        page_id: page_id.to_string(),
        blocks: out,
    })
}
