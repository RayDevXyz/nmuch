//! The block model on top of yrs: editing a page's Y.Doc and reading it back as plain data.
//!
//! Nothing in this module touches SQLite. [`BlockTxn`] turns block operations into Y.Doc
//! changes; [`snapshot`] reads a Y.Doc into a [`PageSnapshot`]. Both work on the XML layout
//! y-prosemirror uses, so the editor and the core read and write the same structure.

use std::collections::BTreeMap;

use yrs::types::text::YChange;
use yrs::types::Attrs;
use yrs::{
    Any, Doc, In, Map, MapPrelim, MapRef, Out, ReadTxn, Text, Transact, TransactionMut, Xml,
    XmlElementPrelim, XmlElementRef, XmlFragment, XmlFragmentPrelim, XmlFragmentRef, XmlOut,
    XmlTextPrelim, XmlTextRef,
};

use crate::database::{sort_by_order, DatabaseDef, Property, View};
use crate::error::{Error, Result};
use crate::schema::{
    keys, new_id, node, BlockId, BlockSnapshot, PageId, PageKind, PageMeta, PageMetaPatch,
    PageSnapshot, SCHEMA_VERSION,
};

// ---------------------------------------------------------------- owned XML tree

/// An owned copy of a piece of a note: what the core builds before inserting it, and what
/// it reads when moving a block. Attribute values keep their types (numbers stay numbers).
#[derive(Debug, Clone, PartialEq)]
pub enum XNode {
    Element {
        tag: String,
        attrs: BTreeMap<String, Any>,
        children: Vec<XNode>,
    },
    /// A text run list: (text, marks as formatting attributes).
    Text(Vec<(String, Option<Attrs>)>),
}

/// Inline content for [`NewBlock`] builders.
#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
    Text(String),
    /// A reference rendered by the editor as the target's live title.
    Ref {
        kind: RefKind,
        target: String,
    },
    Break,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefKind {
    Page,
    Block,
}

impl RefKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RefKind::Page => "page",
            RefKind::Block => "block",
        }
    }
}

impl From<&str> for Inline {
    fn from(s: &str) -> Self {
        Inline::Text(s.to_string())
    }
}

/// Builders for blocks the core can create. Every block gets a fresh `id`.
pub struct NewBlock;

impl NewBlock {
    fn el(tag: &str, attrs: Vec<(&str, Any)>, children: Vec<XNode>) -> XNode {
        let mut map: BTreeMap<String, Any> =
            attrs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        map.insert(keys::ID.to_string(), Any::from(new_id()));
        XNode::Element {
            tag: tag.to_string(),
            attrs: map,
            children,
        }
    }

    fn inline(content: Vec<Inline>) -> Vec<XNode> {
        let mut out = Vec::new();
        let mut run = String::new();
        let flush = |run: &mut String, out: &mut Vec<XNode>| {
            if !run.is_empty() {
                out.push(XNode::Text(vec![(std::mem::take(run), None)]));
            }
        };
        for i in content {
            match i {
                Inline::Text(t) => run.push_str(&t),
                Inline::Ref { kind, target } => {
                    flush(&mut run, &mut out);
                    out.push(XNode::Element {
                        tag: node::REF.into(),
                        attrs: BTreeMap::from([
                            ("kind".to_string(), Any::from(kind.as_str())),
                            ("target".to_string(), Any::from(target)),
                        ]),
                        children: vec![],
                    });
                }
                Inline::Break => {
                    flush(&mut run, &mut out);
                    out.push(XNode::Element {
                        tag: node::HARD_BREAK.into(),
                        attrs: BTreeMap::new(),
                        children: vec![],
                    });
                }
            }
        }
        flush(&mut run, &mut out);
        out
    }

    pub fn paragraph(text: &str) -> XNode {
        Self::paragraph_with(vec![text.into()])
    }

    pub fn paragraph_with(content: Vec<Inline>) -> XNode {
        Self::el(node::PARAGRAPH, vec![], Self::inline(content))
    }

    pub fn heading(level: i64, text: &str) -> XNode {
        Self::el(
            node::HEADING,
            vec![("level", Any::from(level))],
            Self::inline(vec![text.into()]),
        )
    }

    pub fn callout(icon: &str, text: &str) -> XNode {
        Self::el(
            node::CALLOUT,
            vec![("icon", Any::from(icon))],
            Self::inline(vec![text.into()]),
        )
    }

    pub fn code(language: &str, text: &str) -> XNode {
        Self::el(
            node::CODE_BLOCK,
            vec![("language", Any::from(language))],
            Self::inline(vec![text.into()]),
        )
    }

    pub fn quote(text: &str) -> XNode {
        Self::el(node::BLOCKQUOTE, vec![], vec![Self::paragraph(text)])
    }

    pub fn divider() -> XNode {
        Self::el(node::HORIZONTAL_RULE, vec![], vec![])
    }

    pub fn page_link(page_id: &str) -> XNode {
        Self::el(
            node::PAGE_LINK,
            vec![("pageId", Any::from(page_id))],
            vec![],
        )
    }

    /// A widget instance: which widget, how its slots are bound, its own settings.
    pub fn widget(
        widget_id: &str,
        bindings: serde_json::Value,
        settings: serde_json::Value,
    ) -> XNode {
        // Stored as JSON text, the way the editor stores them (see widgets::json_attr).
        Self::el(
            node::WIDGET,
            vec![
                ("widget", Any::from(widget_id)),
                ("bindings", Any::from(bindings.to_string())),
                ("settings", Any::from(settings.to_string())),
            ],
            vec![],
        )
    }

    /// An inline view of a database page.
    pub fn database(database_id: &str, view_id: &str) -> XNode {
        Self::el(
            node::DATABASE,
            vec![
                ("databaseId", Any::from(database_id)),
                ("viewId", Any::from(view_id)),
            ],
            vec![],
        )
    }

    pub fn bullet_list(items: &[&str]) -> XNode {
        let items = items
            .iter()
            .map(|t| Self::el(node::LIST_ITEM, vec![], vec![Self::paragraph(t)]))
            .collect();
        Self::el(node::BULLET_LIST, vec![], items)
    }

    pub fn task_list(items: &[(&str, bool)]) -> XNode {
        let items = items
            .iter()
            .map(|(t, done)| {
                Self::el(
                    node::TASK_ITEM,
                    vec![("checked", Any::from(*done))],
                    vec![Self::paragraph(t)],
                )
            })
            .collect();
        Self::el(node::TASK_LIST, vec![], items)
    }
}

impl XNode {
    pub fn id(&self) -> Option<&str> {
        match self {
            XNode::Element { attrs, .. } => match attrs.get(keys::ID) {
                Some(Any::String(s)) => Some(s),
                _ => None,
            },
            XNode::Text(_) => None,
        }
    }

    fn tag(&self) -> Option<&str> {
        match self {
            XNode::Element { tag, .. } => Some(tag),
            XNode::Text(_) => None,
        }
    }
}

fn read_xnode<T: ReadTxn>(txn: &T, out: XmlOut) -> Option<XNode> {
    match out {
        XmlOut::Element(el) => {
            let attrs = el
                .attributes(txn)
                .filter_map(|(k, v)| match v {
                    Out::Any(a) => Some((k.to_string(), a)),
                    _ => None,
                })
                .collect();
            let children = el
                .children(txn)
                .filter_map(|c| read_xnode(txn, c))
                .collect();
            Some(XNode::Element {
                tag: el.tag().to_string(),
                attrs,
                children,
            })
        }
        XmlOut::Text(t) => Some(XNode::Text(
            t.diff(txn, YChange::identity)
                .into_iter()
                .filter_map(|d| match d.insert {
                    Out::Any(Any::String(s)) => Some((s.to_string(), d.attributes.map(|a| *a))),
                    _ => None,
                })
                .collect(),
        )),
        XmlOut::Fragment(_) => None,
    }
}

fn write_xnode<P: XmlFragment>(txn: &mut TransactionMut, parent: &P, index: u32, n: &XNode) {
    match n {
        XNode::Element {
            tag,
            attrs,
            children,
        } => {
            let el = parent.insert(txn, index, XmlElementPrelim::empty(tag.as_str()));
            for (k, v) in attrs {
                el.insert_attribute(txn, k.as_str(), v.clone());
            }
            for (i, c) in children.iter().enumerate() {
                write_xnode(txn, &el, i as u32, c);
            }
        }
        XNode::Text(runs) => {
            let t = parent.insert(txn, index, XmlTextPrelim::new(""));
            let mut at = 0;
            for (s, marks) in runs {
                match marks {
                    Some(m) => t.insert_with_attributes(txn, at, s, m.clone()),
                    None => t.insert(txn, at, s),
                }
                at += s.chars().count() as u32;
            }
        }
    }
}

// ---------------------------------------------------------------- page init

fn any_str(v: &str) -> Any {
    Any::from(v)
}

fn opt_str(v: &Option<String>) -> Any {
    v.as_deref().map(any_str).unwrap_or(Any::Null)
}

/// Write the root maps, the page metadata and one note with an empty paragraph.
pub(crate) fn init_page(doc: &Doc, page_id: &str, meta: &PageMeta) -> String {
    let page = doc.get_or_insert_map(keys::PAGE);
    let notes = doc.get_or_insert_map(keys::NOTES);
    doc.get_or_insert_map(keys::PROPS);
    doc.get_or_insert_map(keys::SURFACE);
    let mut txn = doc.transact_mut();
    page.insert(&mut txn, keys::ID, page_id);
    page.insert(&mut txn, keys::SCHEMA, SCHEMA_VERSION);
    apply_meta(&mut txn, &page, &PageMetaPatch::from_meta(meta));
    let note_id = new_id();
    let content = insert_note(&mut txn, &notes, &note_id, "a0");
    write_xnode(&mut txn, &content, 0, &NewBlock::paragraph(""));
    note_id
}

fn insert_note(
    txn: &mut TransactionMut,
    notes: &MapRef,
    note_id: &str,
    order: &str,
) -> XmlFragmentRef {
    let note = notes.insert(
        txn,
        note_id,
        MapPrelim::from_iter([
            (keys::ID, In::from(note_id)),
            (keys::NOTE_ORDER, In::from(order)),
            (keys::NOTE_XYWH, In::Any(Any::Null)),
            (
                keys::NOTE_CONTENT,
                In::XmlFragment(XmlFragmentPrelim::default()),
            ),
        ]),
    );
    match note.get(txn, keys::NOTE_CONTENT) {
        Some(Out::YXmlFragment(f)) => f,
        _ => unreachable!("note content was just inserted"),
    }
}

fn apply_meta(txn: &mut TransactionMut, page: &MapRef, p: &PageMetaPatch) {
    if let Some(v) = p.kind {
        page.insert(txn, "kind", v.as_str());
    }
    if let Some(v) = &p.database_id {
        page.insert(txn, "database", opt_str(v));
    }
    if let Some(v) = &p.title {
        page.insert(txn, "title", any_str(v));
    }
    if let Some(v) = &p.icon {
        page.insert(txn, "icon", any_str(v));
    }
    if let Some(v) = &p.parent_id {
        page.insert(txn, "parent", opt_str(v));
    }
    if let Some(v) = &p.key {
        page.insert(txn, "key", any_str(v));
    }
    if let Some(v) = p.favorite {
        page.insert(txn, "favorite", v);
    }
    if let Some(v) = p.archived {
        page.insert(txn, "archived", v);
    }
    if let Some(v) = p.trashed_at {
        page.insert(
            txn,
            "trashedAt",
            v.map(|t| Any::from(t as f64)).unwrap_or(Any::Null),
        );
    }
}

fn read_meta<T: ReadTxn>(txn: &T, page: &MapRef) -> PageMeta {
    let s = |k: &str| match page.get(txn, k) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };
    let b = |k: &str| matches!(page.get(txn, k), Some(Out::Any(Any::Bool(true))));
    let n = |k: &str| match page.get(txn, k) {
        Some(Out::Any(a)) => serde_json::to_value(a)
            .ok()
            .and_then(|v| v.as_f64())
            .map(|f| f as i64),
        _ => None,
    };
    PageMeta {
        kind: match s("kind").as_deref() {
            Some("database") => PageKind::Database,
            _ => PageKind::Page,
        },
        database_id: s("database"),
        title: s("title").unwrap_or_default(),
        icon: s("icon").unwrap_or_default(),
        parent_id: s("parent"),
        key: s("key").unwrap_or_default(),
        favorite: b("favorite"),
        archived: b("archived"),
        trashed_at: n("trashedAt"),
    }
}

// ---------------------------------------------------------------- locating blocks

#[derive(Clone)]
enum Container {
    Note(XmlFragmentRef),
    Block(XmlElementRef),
}

impl Container {
    fn tag(&self) -> String {
        match self {
            Container::Note(_) => node::NOTE.to_string(),
            Container::Block(el) => el.tag().to_string(),
        }
    }

    fn children<T: ReadTxn>(&self, txn: &T) -> Vec<XmlOut> {
        match self {
            Container::Note(f) => f.children(txn).collect(),
            Container::Block(e) => e.children(txn).collect(),
        }
    }

    fn insert(&self, txn: &mut TransactionMut, index: u32, n: &XNode) {
        match self {
            Container::Note(f) => write_xnode(txn, f, index, n),
            Container::Block(e) => write_xnode(txn, e, index, n),
        }
    }

    fn remove(&self, txn: &mut TransactionMut, index: u32) {
        match self {
            Container::Note(f) => f.remove_range(txn, index, 1),
            Container::Block(e) => e.remove_range(txn, index, 1),
        }
    }

    fn len<T: ReadTxn>(&self, txn: &T) -> u32 {
        match self {
            Container::Note(f) => f.len(txn),
            Container::Block(e) => e.len(txn),
        }
    }
}

struct Located {
    el: XmlElementRef,
    parent: Container,
    /// The block that owns `parent` (None at the top of a note).
    parent_block: Option<XmlElementRef>,
}

fn attr_str<T: ReadTxn>(txn: &T, el: &XmlElementRef, key: &str) -> Option<String> {
    match el.get_attribute(txn, key) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

fn index_of<T: ReadTxn>(txn: &T, parent: &Container, el: &XmlElementRef) -> Option<u32> {
    parent
        .children(txn)
        .iter()
        .position(|c| matches!(c, XmlOut::Element(e) if e == el))
        .map(|i| i as u32)
}

/// Note fragments ordered by (order, id).
fn ordered_notes<T: ReadTxn>(
    txn: &T,
    notes: &MapRef,
) -> Vec<(String, String, Option<serde_json::Value>, XmlFragmentRef)> {
    let mut out: Vec<_> = notes
        .iter(txn)
        .filter_map(|(id, v)| {
            let Out::YMap(m) = v else { return None };
            let order = match m.get(txn, keys::NOTE_ORDER) {
                Some(Out::Any(Any::String(s))) => s.to_string(),
                _ => String::new(),
            };
            let xywh = match m.get(txn, keys::NOTE_XYWH) {
                Some(Out::Any(Any::Null)) | None => None,
                Some(Out::Any(a)) => Some(to_json(&a)),
                _ => None,
            };
            match m.get(txn, keys::NOTE_CONTENT) {
                Some(Out::YXmlFragment(f)) => Some((id.to_string(), order, xywh, f)),
                _ => None,
            }
        })
        .collect();
    out.sort_by(|a, b| (&a.1, &a.0).cmp(&(&b.1, &b.0)));
    out
}

// ---------------------------------------------------------------- write transaction

/// A write transaction over one page.
///
/// Created by [`crate::Core::transact`]; every change made through it becomes part of a
/// single yrs update, which the core appends to the log and projects into the index.
pub struct BlockTxn<'a, 'doc> {
    txn: &'a mut TransactionMut<'doc>,
    page: MapRef,
    notes: MapRef,
    props: MapRef,
    db_props: MapRef,
    db_views: MapRef,
    surface: MapRef,
    page_id: PageId,
}

impl<'a, 'doc> BlockTxn<'a, 'doc> {
    pub(crate) fn new(
        txn: &'a mut TransactionMut<'doc>,
        doc_maps: DocMaps,
        page_id: PageId,
    ) -> Self {
        let DocMaps {
            page,
            notes,
            props,
            db_props,
            db_views,
            surface,
        } = doc_maps;
        Self {
            txn,
            page,
            notes,
            props,
            db_props,
            db_views,
            surface,
            page_id,
        }
    }

    // ---- database pages (see database.rs)

    fn require_database(&self) -> Result<()> {
        if self.meta().kind != PageKind::Database {
            return Err(Error::Invalid(format!(
                "{} is not a database",
                self.page_id
            )));
        }
        Ok(())
    }

    /// Add or replace a column definition.
    pub fn set_db_property(&mut self, prop: &Property) -> Result<()> {
        self.require_database()?;
        let json = serde_json::to_value(prop).map_err(|e| Error::Invalid(e.to_string()))?;
        self.db_props
            .insert(self.txn, prop.id.as_str(), to_any(json)?);
        Ok(())
    }

    pub fn remove_db_property(&mut self, id: &str) -> Result<()> {
        self.require_database()?;
        self.db_props.remove(self.txn, id);
        Ok(())
    }

    /// Add or replace a saved view.
    pub fn set_db_view(&mut self, view: &View) -> Result<()> {
        self.require_database()?;
        let json = serde_json::to_value(view).map_err(|e| Error::Invalid(e.to_string()))?;
        self.db_views
            .insert(self.txn, view.id.as_str(), to_any(json)?);
        Ok(())
    }

    pub fn remove_db_view(&mut self, id: &str) -> Result<()> {
        self.require_database()?;
        self.db_views.remove(self.txn, id);
        Ok(())
    }

    // ---- edgeless (see surface.rs)

    /// Add or replace an edgeless element. `element` is a JSON object with at least `type`;
    /// every field becomes one entry of the element's map, so concurrent edits to different
    /// fields (one person moves a shape, another renames it) both survive.
    pub fn set_element(&mut self, id: &str, element: serde_json::Value) -> Result<()> {
        let fields = crate::surface::validate(id, element)?;
        let prelim = fields
            .into_iter()
            .map(|(k, v)| Ok((k, In::Any(to_any(v)?))))
            .collect::<Result<Vec<_>>>()?;
        self.surface
            .insert(self.txn, id, MapPrelim::from_iter(prelim));
        Ok(())
    }

    /// Change some fields of an existing element.
    pub fn update_element(&mut self, id: &str, patch: serde_json::Value) -> Result<()> {
        let Some(Out::YMap(m)) = self.surface.get(&*self.txn, id) else {
            return Err(Error::BlockNotFound(id.to_string()));
        };
        let serde_json::Value::Object(patch) = patch else {
            return Err(Error::Invalid("element patch must be an object".into()));
        };
        for (k, v) in patch {
            if k == keys::ID || k == keys::EL_TYPE {
                return Err(Error::Invalid(format!("an element's {k} can't change")));
            }
            m.insert(self.txn, k, to_any(v)?);
        }
        Ok(())
    }

    pub fn remove_element(&mut self, id: &str) {
        self.surface.remove(self.txn, id);
    }

    /// Place a note on the canvas, or show it only there (`display = "edgeless"`).
    pub fn set_note_layout(
        &mut self,
        note_id: &str,
        xywh: Option<[f64; 4]>,
        display: Option<&str>,
    ) -> Result<()> {
        let Some(Out::YMap(m)) = self.notes.get(&*self.txn, note_id) else {
            return Err(Error::BlockNotFound(note_id.to_string()));
        };
        if let Some(x) = xywh {
            m.insert(self.txn, keys::NOTE_XYWH, to_any(serde_json::json!(x))?);
        }
        if let Some(d) = display {
            if !matches!(d, "both" | "edgeless") {
                return Err(Error::Invalid(format!(
                    "note display must be both or edgeless, not {d}"
                )));
            }
            m.insert(self.txn, keys::NOTE_DISPLAY, d);
        }
        Ok(())
    }

    pub fn page_id(&self) -> &str {
        &self.page_id
    }

    pub fn meta(&self) -> PageMeta {
        read_meta(&*self.txn, &self.page)
    }

    pub fn set_meta(&mut self, patch: &PageMetaPatch) {
        apply_meta(self.txn, &self.page, patch);
    }

    /// Ids of the page's notes in display order.
    pub fn note_ids(&self) -> Vec<String> {
        ordered_notes(&*self.txn, &self.notes)
            .into_iter()
            .map(|n| n.0)
            .collect()
    }

    /// The first note (every page has at least one).
    pub fn first_note(&self) -> Result<String> {
        self.note_ids()
            .into_iter()
            .next()
            .ok_or_else(|| Error::Malformed("page has no notes".into()))
    }

    /// Add a note after the existing ones. It starts with one empty paragraph.
    pub fn add_note(&mut self) -> String {
        let last = ordered_notes(&*self.txn, &self.notes)
            .last()
            .map(|n| n.1.clone());
        let order = format!("{}0", last.unwrap_or_else(|| "a".into())); // "a0" < "a00" < ...
        let id = new_id();
        let content = insert_note(self.txn, &self.notes, &id, &order);
        write_xnode(self.txn, &content, 0, &NewBlock::paragraph(""));
        id
    }

    /// Insert `block` into `parent` (a note id or a block id) at `index` (`None` appends).
    /// Returns the new block's id. Fails if the editor schema would not allow it there.
    pub fn insert(&mut self, parent: &str, index: Option<u32>, block: XNode) -> Result<BlockId> {
        let container = self.container(parent)?;
        let tag = block
            .tag()
            .ok_or_else(|| Error::Invalid("can only insert elements".into()))?;
        if !node::allows(&container.tag(), tag) {
            return Err(Error::Invalid(format!(
                "{tag} is not allowed inside {}",
                container.tag()
            )));
        }
        let id = block
            .id()
            .ok_or_else(|| Error::Invalid("block has no id".into()))?
            .to_string();
        let blocks = self.block_children(&container);
        let index = match index {
            None => container.len(&*self.txn),
            Some(i) if (i as usize) < blocks.len() => blocks[i as usize].0,
            Some(i) if i as usize == blocks.len() => container.len(&*self.txn),
            Some(i) => return Err(Error::Invalid(format!("index {i} out of range"))),
        };
        container.insert(self.txn, index, &block);
        Ok(id)
    }

    pub fn append(&mut self, parent: &str, block: XNode) -> Result<BlockId> {
        self.insert(parent, None, block)
    }

    /// Replace the inline content of a text block (paragraph, heading, code, callout).
    pub fn set_text(&mut self, id: &str, text: &str) -> Result<()> {
        let loc = self.find(id)?;
        if !node::TEXTBLOCKS.contains(&loc.el.tag().as_ref()) {
            return Err(Error::Invalid(format!(
                "{} has no inline text",
                loc.el.tag()
            )));
        }
        let len = loc.el.len(&*self.txn);
        if len > 0 {
            loc.el.remove_range(self.txn, 0, len);
        }
        if !text.is_empty() {
            loc.el.insert(self.txn, 0, XmlTextPrelim::new(text));
        }
        Ok(())
    }

    /// Set a node attribute, e.g. `checked` on a task item or `level` on a heading.
    pub fn set_attr(&mut self, id: &str, key: &str, value: serde_json::Value) -> Result<()> {
        if key == keys::ID {
            return Err(Error::Invalid("the id attribute is fixed".into()));
        }
        let any = to_any(value)?;
        let loc = self.find(id)?;
        loc.el.insert_attribute(self.txn, key, any);
        Ok(())
    }

    /// Set a module property on a block (or on the page, using the page id).
    /// Keys should be namespaced by their owner, e.g. `course.progress`.
    pub fn set_prop(&mut self, id: &str, key: &str, value: serde_json::Value) -> Result<()> {
        if id != self.page_id {
            self.find(id)?;
        }
        let any = to_any(value)?;
        let map = match self.props.get(&*self.txn, id) {
            Some(Out::YMap(m)) => m,
            _ => self.props.insert(self.txn, id, MapPrelim::default()),
        };
        map.insert(self.txn, key, any);
        Ok(())
    }

    pub fn remove_prop(&mut self, id: &str, key: &str) -> Result<()> {
        if let Some(Out::YMap(m)) = self.props.get(&*self.txn, id) {
            m.remove(self.txn, key);
        }
        Ok(())
    }

    /// Delete a block and everything below it. Containers left empty (a list with no
    /// items, a quote with no paragraphs) are removed too, and a note never ends up empty.
    pub fn delete_block(&mut self, id: &str) -> Result<()> {
        let loc = self.find(id)?;
        self.remove_located(loc);
        self.props.remove(self.txn, id);
        Ok(())
    }

    /// Move a block (with its subtree, ids and attributes) under `new_parent` at `index`.
    ///
    /// Yjs has no move operation: the subtree is copied to the new place and the original
    /// deleted, in one transaction. Edits a remote replica makes to the original at the same
    /// moment are lost; see the spike doc.
    pub fn move_block(&mut self, id: &str, new_parent: &str, index: Option<u32>) -> Result<()> {
        let loc = self.find(id)?;
        if self.subtree_ids(&loc.el).iter().any(|i| i == new_parent) {
            return Err(Error::Invalid("cannot move a block inside itself".into()));
        }
        let copy = read_xnode(&*self.txn, XmlOut::Element(loc.el.clone()))
            .ok_or_else(|| Error::Malformed("unreadable block".into()))?;
        // Insert first so a container that becomes empty isn't cleaned up under us.
        let orig = loc.el.clone();
        self.insert(new_parent, index, copy)?;
        let parent = loc.parent.clone();
        let idx = index_of(&*self.txn, &parent, &orig)
            .ok_or_else(|| Error::Malformed("original vanished".into()))?;
        self.remove_at(
            Located {
                el: orig,
                parent,
                parent_block: loc.parent_block,
            },
            idx,
        );
        Ok(())
    }

    // ---- internals

    fn remove_located(&mut self, loc: Located) {
        let Some(idx) = index_of(&*self.txn, &loc.parent, &loc.el) else {
            return;
        };
        self.remove_at(loc, idx);
    }

    fn remove_at(&mut self, loc: Located, idx: u32) {
        // The paragraph that opens a list/task item *is* the item: delete the item instead.
        if let Some(pb) = &loc.parent_block {
            let item = [node::LIST_ITEM, node::TASK_ITEM].contains(&pb.tag().as_ref());
            if item && idx == 0 {
                if let Ok(owner) = self.find_el(pb) {
                    return self.remove_located(owner);
                }
            }
        }
        loc.parent.remove(self.txn, idx);
        match (&loc.parent, &loc.parent_block) {
            (Container::Note(f), _) if f.len(&*self.txn) == 0 => {
                write_xnode(self.txn, f, 0, &NewBlock::paragraph(""));
            }
            (Container::Block(e), Some(pb)) if e.len(&*self.txn) == 0 => {
                let needs_content = [
                    node::BULLET_LIST,
                    node::ORDERED_LIST,
                    node::TASK_LIST,
                    node::BLOCKQUOTE,
                ]
                .contains(&pb.tag().as_ref());
                if needs_content {
                    if let Ok(owner) = self.find_el(pb) {
                        self.remove_located(owner);
                    }
                }
            }
            _ => {}
        }
    }

    fn subtree_ids(&self, el: &XmlElementRef) -> Vec<String> {
        let mut out = Vec::new();
        let mut stack = vec![el.clone()];
        while let Some(e) = stack.pop() {
            out.extend(attr_str(&*self.txn, &e, keys::ID));
            for c in e.children(&*self.txn) {
                if let XmlOut::Element(ce) = c {
                    stack.push(ce);
                }
            }
        }
        out
    }

    /// Block-level element children of a container: (raw index, element).
    fn block_children(&self, c: &Container) -> Vec<(u32, XmlElementRef)> {
        c.children(&*self.txn)
            .into_iter()
            .enumerate()
            .filter_map(|(i, o)| match o {
                XmlOut::Element(e) if !node::is_inline(e.tag()) => Some((i as u32, e)),
                _ => None,
            })
            .collect()
    }

    fn container(&self, id: &str) -> Result<Container> {
        if let Some(Out::YMap(n)) = self.notes.get(&*self.txn, id) {
            if let Some(Out::YXmlFragment(f)) = n.get(&*self.txn, keys::NOTE_CONTENT) {
                return Ok(Container::Note(f));
            }
        }
        if id == self.page_id {
            let first = self.first_note()?;
            return self.container(&first);
        }
        Ok(Container::Block(self.find(id)?.el))
    }

    fn find(&self, id: &str) -> Result<Located> {
        self.search(|txn, e| attr_str(txn, e, keys::ID).as_deref() == Some(id))
            .ok_or_else(|| Error::BlockNotFound(id.to_string()))
    }

    fn find_el(&self, el: &XmlElementRef) -> Result<Located> {
        self.search(|_, e| e == el)
            .ok_or_else(|| Error::Malformed("element not in page".into()))
    }

    fn search(&self, pred: impl Fn(&TransactionMut, &XmlElementRef) -> bool) -> Option<Located> {
        let txn = &*self.txn;
        for (_, _, _, frag) in ordered_notes(txn, &self.notes) {
            let mut stack: Vec<(Container, Option<XmlElementRef>)> =
                vec![(Container::Note(frag), None)];
            while let Some((parent, parent_block)) = stack.pop() {
                for child in parent.children(txn) {
                    if let XmlOut::Element(e) = child {
                        if pred(txn, &e) {
                            return Some(Located {
                                el: e,
                                parent: parent.clone(),
                                parent_block: parent_block.clone(),
                            });
                        }
                        stack.push((Container::Block(e.clone()), Some(e)));
                    }
                }
            }
        }
        None
    }
}

fn to_any(value: serde_json::Value) -> Result<Any> {
    serde_json::from_value(value)
        .map_err(|e| Error::Invalid(format!("value not representable: {e}")))
}

/// Any -> JSON. yrs serializes every number as a float; whole numbers become integers again
/// so `2` round-trips as `2`, not `2.0`.
pub(crate) fn to_json(a: &Any) -> serde_json::Value {
    fn norm(v: serde_json::Value) -> serde_json::Value {
        use serde_json::Value;
        match v {
            Value::Number(n) => match n.as_f64() {
                Some(f) if f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 => {
                    Value::from(f as i64)
                }
                _ => Value::Number(n),
            },
            Value::Array(a) => Value::Array(a.into_iter().map(norm).collect()),
            Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, norm(v))).collect()),
            other => other,
        }
    }
    norm(serde_json::to_value(a).unwrap_or(serde_json::Value::Null))
}

// ---------------------------------------------------------------- reading

/// Read a page's Y.Doc into plain data: the page block, then each note and its blocks in
/// document order.
///
/// Elements without an `id` (for instance created by an older client) are skipped as blocks,
/// but their children are still read and attached to the nearest block above them.
pub fn snapshot(doc: &Doc, page_id: &str) -> Result<PageSnapshot> {
    let page = doc.get_or_insert_map(keys::PAGE);
    let notes = doc.get_or_insert_map(keys::NOTES);
    let props = doc.get_or_insert_map(keys::PROPS);
    let db_props = doc.get_or_insert_map(keys::DB_PROPERTIES);
    let db_views = doc.get_or_insert_map(keys::DB_VIEWS);
    let surface = doc.get_or_insert_map(keys::SURFACE);
    let txn = doc.transact();
    if page.get(&txn, keys::ID).is_none() {
        return Err(Error::PageNotFound(page_id.to_string()));
    }
    let meta = read_meta(&txn, &page);
    let props_of = |id: &str| -> BTreeMap<String, serde_json::Value> {
        match props.get(&txn, id) {
            Some(Out::YMap(m)) => m
                .iter(&txn)
                .filter_map(|(k, v)| match v {
                    Out::Any(a) => Some((k.to_string(), to_json(&a))),
                    _ => None,
                })
                .collect(),
            _ => BTreeMap::new(),
        }
    };

    let mut blocks = vec![BlockSnapshot {
        id: page_id.to_string(),
        page_id: page_id.to_string(),
        parent: None,
        note_id: None,
        flavour: node::PAGE.into(),
        position: 0,
        depth: 0,
        text: meta.title.clone(),
        attrs: BTreeMap::new(),
        props: props_of(page_id),
        refs: vec![],
    }];

    for (pos, (note_id, order, xywh, frag)) in ordered_notes(&txn, &notes).into_iter().enumerate() {
        let mut attrs = BTreeMap::from([("order".to_string(), serde_json::Value::String(order))]);
        if let Some(x) = xywh {
            attrs.insert("xywh".into(), x);
        }
        if let Some(Out::YMap(m)) = notes.get(&txn, &note_id) {
            if let Some(Out::Any(Any::String(d))) = m.get(&txn, keys::NOTE_DISPLAY) {
                attrs.insert("display".into(), serde_json::Value::String(d.to_string()));
            }
        }
        blocks.push(BlockSnapshot {
            id: note_id.clone(),
            page_id: page_id.to_string(),
            parent: Some(page_id.to_string()),
            note_id: None,
            flavour: node::NOTE.into(),
            position: pos as u32,
            depth: 1,
            text: String::new(),
            attrs,
            props: props_of(&note_id),
            refs: vec![],
        });
        let mut ctx = Walk {
            txn: &txn,
            page_id,
            note_id: &note_id,
            out: &mut blocks,
            props_of: &props_of,
        };
        let children: Vec<XmlOut> = frag.children(&txn).collect();
        ctx.walk_children(children, &note_id, 2);
    }
    for (pos, el) in crate::surface::read_elements(&txn, &surface)
        .into_iter()
        .enumerate()
    {
        blocks.push(BlockSnapshot {
            id: el.id.clone(),
            page_id: page_id.to_string(),
            parent: Some(page_id.to_string()),
            note_id: None,
            flavour: format!("{}{}", node::SURFACE_PREFIX, el.kind),
            position: pos as u32,
            depth: 1,
            text: el.text.clone(),
            // A pin links to the page it marks (so that page's backlinks show the map).
            refs: match (
                el.kind.as_str(),
                el.attrs.get("page").and_then(|p| p.as_str()),
            ) {
                ("pin", Some(p)) => vec![(p.to_string(), "page".to_string())],
                _ => vec![],
            },
            attrs: el.attrs,
            props: props_of(&el.id),
        });
    }
    let database =
        (meta.kind == PageKind::Database).then(|| read_database(&txn, &db_props, &db_views));
    Ok(PageSnapshot {
        page_id: page_id.to_string(),
        meta,
        blocks,
        database,
    })
}

/// Columns and views of a database page. Entries that don't parse (written by a newer
/// version, say) are skipped rather than failing the whole page.
fn read_database<T: ReadTxn>(txn: &T, props: &MapRef, views: &MapRef) -> DatabaseDef {
    fn parse<T: ReadTxn, V: serde::de::DeserializeOwned>(txn: &T, map: &MapRef) -> Vec<V> {
        map.iter(txn)
            .filter_map(|(_, v)| match v {
                Out::Any(a) => serde_json::from_value(to_json(&a)).ok(),
                _ => None,
            })
            .collect()
    }
    let mut properties: Vec<Property> = parse(txn, props);
    let mut views: Vec<View> = parse(txn, views);
    sort_by_order(&mut properties, |p| (p.order.as_str(), p.id.as_str()));
    sort_by_order(&mut views, |v| (v.order.as_str(), v.id.as_str()));
    DatabaseDef { properties, views }
}

struct Walk<'a, T: ReadTxn, F: Fn(&str) -> BTreeMap<String, serde_json::Value>> {
    txn: &'a T,
    page_id: &'a str,
    note_id: &'a str,
    out: &'a mut Vec<BlockSnapshot>,
    props_of: &'a F,
}

impl<T: ReadTxn, F: Fn(&str) -> BTreeMap<String, serde_json::Value>> Walk<'_, T, F> {
    /// Emit the block-level children of a container; returns how many blocks were emitted
    /// at this level (positions continue across id-less wrappers).
    fn walk_children(&mut self, children: Vec<XmlOut>, parent: &str, depth: u32) {
        let mut position = 0;
        self.walk_level(children, parent, depth, &mut position);
    }

    fn walk_level(&mut self, children: Vec<XmlOut>, parent: &str, depth: u32, position: &mut u32) {
        for child in children {
            let XmlOut::Element(el) = child else { continue };
            let tag = el.tag().to_string();
            if node::is_inline(&tag) {
                continue;
            }
            let kids: Vec<XmlOut> = el.children(self.txn).collect();
            let Some(id) = attr_str(self.txn, &el, keys::ID) else {
                self.walk_level(kids, parent, depth, position);
                continue;
            };

            let mut text = String::new();
            let mut refs = Vec::new();
            for k in &kids {
                match k {
                    XmlOut::Text(t) => text.push_str(&plain(self.txn, t)),
                    XmlOut::Element(e) if e.tag().as_ref() == node::HARD_BREAK => text.push('\n'),
                    XmlOut::Element(e) if e.tag().as_ref() == node::REF => {
                        if let (Some(target), kind) = (
                            attr_str(self.txn, e, "target"),
                            attr_str(self.txn, e, "kind"),
                        ) {
                            text.push(crate::index::REF_MARK);
                            refs.push((target, kind.unwrap_or_else(|| "page".into())));
                        }
                    }
                    _ => {}
                }
            }
            let mut attrs: BTreeMap<String, serde_json::Value> = el
                .attributes(self.txn)
                .filter(|(k, _)| AsRef::<str>::as_ref(k) != keys::ID)
                .filter_map(|(k, v)| match v {
                    Out::Any(a) => Some((k.to_string(), to_json(&a))),
                    _ => None,
                })
                .collect();
            if tag == node::WIDGET {
                // Link the widget to the databases it is bound to (backlinks: "used by").
                if let Some(serde_json::Value::Object(b)) =
                    crate::widgets::json_attr(&attrs, "bindings")
                {
                    for binding in b.values() {
                        if let Some(serde_json::Value::String(d)) = binding.get("databaseId") {
                            refs.push((d.clone(), "page".into()));
                        }
                    }
                }
            }
            if tag == node::DATABASE {
                if let Some(serde_json::Value::String(d)) = attrs.get("databaseId") {
                    text.push(crate::index::REF_MARK);
                    refs.push((d.clone(), "page".into()));
                }
            }
            if tag == node::PAGE_LINK {
                if let Some(serde_json::Value::String(p)) = attrs.get("pageId") {
                    // Its "text" is the linked page's title, resolved at query time like an inline ref.
                    text.push(crate::index::REF_MARK);
                    refs.push((p.clone(), "page".into()));
                }
            }
            if tag == node::IMAGE {
                if let Some(serde_json::Value::String(c)) = attrs.get("caption") {
                    text = c.clone();
                }
                // Keep inline image data out of the index.
                if matches!(attrs.get("src"), Some(serde_json::Value::String(s)) if s.starts_with("data:"))
                {
                    attrs.insert("src".into(), serde_json::Value::String("data:…".into()));
                }
            }

            self.out.push(BlockSnapshot {
                props: (self.props_of)(&id),
                id: id.clone(),
                page_id: self.page_id.to_string(),
                parent: Some(parent.to_string()),
                note_id: Some(self.note_id.to_string()),
                flavour: tag,
                position: *position,
                depth,
                text,
                attrs,
                refs,
            });
            *position += 1;
            self.walk_children(kids, &id, depth + 1);
        }
    }
}

fn plain<T: ReadTxn>(txn: &T, t: &XmlTextRef) -> String {
    t.diff(txn, YChange::identity)
        .into_iter()
        .filter_map(|d| match d.insert {
            Out::Any(Any::String(s)) => Some(s.to_string()),
            _ => None,
        })
        .collect()
}

/// The root maps [`BlockTxn`] works on.
pub(crate) struct DocMaps {
    page: MapRef,
    notes: MapRef,
    props: MapRef,
    db_props: MapRef,
    db_views: MapRef,
    surface: MapRef,
}

/// Read the root maps needed by [`BlockTxn`]. Must be called outside any transaction.
pub(crate) fn doc_maps(doc: &Doc) -> DocMaps {
    DocMaps {
        page: doc.get_or_insert_map(keys::PAGE),
        notes: doc.get_or_insert_map(keys::NOTES),
        props: doc.get_or_insert_map(keys::PROPS),
        db_props: doc.get_or_insert_map(keys::DB_PROPERTIES),
        db_views: doc.get_or_insert_map(keys::DB_VIEWS),
        surface: doc.get_or_insert_map(keys::SURFACE),
    }
}

/// The `page.id` stored inside a doc.
pub(crate) fn stored_page_id(doc: &Doc) -> Option<String> {
    let page = doc.get_or_insert_map(keys::PAGE);
    let txn = doc.transact();
    match page.get(&txn, keys::ID) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}
