//! Databases: a database is a page with `kind = "database"`. Its Y.Doc holds the columns
//! (`dbProperties`) and saved views (`dbViews`); its rows are ordinary pages whose `page.database`
//! points back at it, with cell values stored as props `db.<property_id>` on the row page.
//!
//! - **Relations** are stored on one side only (the row that *has* the relation keeps a list of
//!   row ids). The other side, if the relation is two-way, is a *computed* property that reads the
//!   same links backwards from the index. Both sides can never disagree.
//! - **Rollups** are never stored: [`Core::query_database`] computes them from the index each time.
//!
//! This file has the definitions and the write operations; the query engine is in `db_query.rs`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::Core;
use crate::error::{Error, Result};
use crate::schema::{keys, new_id, PageId, PageKind, PageMeta, PageMetaPatch};

/// The id of the column every database has: the row's page title.
pub const TITLE: &str = "title";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PropType {
    Title,
    Text,
    Number,
    Select,
    MultiSelect,
    Date,
    Checkbox,
    Url,
    /// A path to a file or folder on disk (course folders, video files).
    File,
    Relation,
    Rollup,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationConfig {
    /// The database the related rows belong to.
    pub database_id: PageId,
    /// The paired column in the other database, for a two-way relation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synced_property: Option<String>,
    /// True on the side that stores nothing and reads the links backwards.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub computed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RollupFn {
    /// Number of related rows.
    Count,
    /// Number of related rows where the property has a value.
    CountValues,
    /// Share of related rows where a checkbox is checked, 0.0–1.0 (progress).
    PercentChecked,
    Sum,
    Average,
    Min,
    Max,
    /// The related rows' values, as a list.
    ShowValues,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollupConfig {
    /// A relation column of this database.
    pub relation: String,
    /// The column of the related database to roll up (`title` works too).
    pub property: String,
    pub function: RollupFn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: PropType,
    /// Fractional sort key: column order.
    #[serde(default)]
    pub order: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SelectOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation: Option<RelationConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollup: Option<RollupConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewKind {
    Table,
    Board,
    Gallery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Is,
    IsNot,
    Contains,
    NotContains,
    Gt,
    Lt,
    Empty,
    NotEmpty,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub property: String,
    pub op: FilterOp,
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub property: String,
    #[serde(default)]
    pub desc: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: ViewKind,
    #[serde(default)]
    pub order: String,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub sorts: Vec<Sort>,
    /// Board: the select column that makes the board's columns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<String>,
    /// Columns this view hides. Columns not listed show, so new columns appear everywhere.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden: Vec<String>,
}

/// A database's definition as read from its Y.Doc.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDef {
    pub properties: Vec<Property>,
    pub views: Vec<View>,
}

impl DatabaseDef {
    pub fn property(&self, id: &str) -> Option<&Property> {
        self.properties.iter().find(|p| p.id == id)
    }
}

pub(crate) fn sort_by_order<T>(items: &mut [T], key: impl Fn(&T) -> (&str, &str)) {
    items.sort_by(|a, b| key(a).cmp(&key(b)));
}

/// The next fractional key after `last` (keys only ever grow at the end, which is all the
/// core needs; the UI can place keys between neighbours itself).
pub(crate) fn key_after(last: Option<&str>) -> String {
    match last {
        None | Some("") => "a0".into(),
        Some(k) => {
            // "a0" -> "a1" ... "a9" -> "a9V"... keep it simple: bump the last char if we can.
            const DIGITS: &str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
            let mut chars: Vec<char> = k.chars().collect();
            let last = *chars.last().unwrap();
            match DIGITS.find(last) {
                Some(i) if i + 1 < DIGITS.len() => {
                    *chars.last_mut().unwrap() = DIGITS.as_bytes()[i + 1] as char;
                    chars.into_iter().collect()
                }
                _ => format!("{k}V"),
            }
        }
    }
}

/// Check and normalize a cell value for a column type. `Ok(None)` means "clear the cell".
pub fn normalize_value(prop: &Property, value: Value) -> Result<Option<Value>> {
    let bad = |what: &str| Err(Error::Invalid(format!("{} expects {what}", prop.name)));
    if value.is_null() {
        return Ok(None);
    }
    match prop.kind {
        PropType::Title | PropType::Text | PropType::Url | PropType::File | PropType::Date => {
            match value {
                Value::String(s) if s.is_empty() => Ok(None),
                Value::String(_) => Ok(Some(value)),
                _ => bad("text"),
            }
        }
        PropType::Number => match &value {
            Value::Number(_) => Ok(Some(value)),
            Value::String(s) if s.trim().is_empty() => Ok(None),
            Value::String(s) => s
                .trim()
                .parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64)
                .map(|n| Some(Value::Number(n)))
                .map_or_else(|| bad("a number"), Ok),
            _ => bad("a number"),
        },
        PropType::Checkbox => match value {
            Value::Bool(true) => Ok(Some(value)),
            Value::Bool(false) => Ok(None),
            _ => bad("true or false"),
        },
        PropType::Select => match value {
            Value::String(s) if s.is_empty() => Ok(None),
            Value::String(_) => Ok(Some(value)),
            _ => bad("an option id"),
        },
        PropType::MultiSelect | PropType::Relation => match value {
            Value::Array(items) => {
                let mut ids: Vec<String> = Vec::new();
                for item in items {
                    match item {
                        Value::String(s) if !s.is_empty() && !ids.contains(&s) => ids.push(s),
                        Value::String(_) => {}
                        _ => return bad("a list of ids"),
                    }
                }
                Ok((!ids.is_empty()).then(|| Value::from(ids)))
            }
            _ => bad("a list of ids"),
        },
        PropType::Rollup => Err(Error::Invalid(format!(
            "{} is computed and can't be set",
            prop.name
        ))),
    }
}

pub(crate) fn value_key(prop_id: &str) -> String {
    format!("{}{prop_id}", keys::DB_VALUE_PREFIX)
}

// ------------------------------------------------------------------ write operations

/// A relation to create with [`Core::create_relation`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRelation {
    pub name: String,
    pub target_database: PageId,
    /// Also show the relation on the other database.
    #[serde(default)]
    pub two_way: bool,
    /// Name of the column on the other database (two-way only).
    #[serde(default)]
    pub reverse_name: Option<String>,
}

impl Core {
    /// Create a database page with a title column and one table view.
    pub fn create_database(&mut self, id: &str, mut meta: PageMeta) -> Result<PageId> {
        meta.kind = PageKind::Database;
        meta.database_id = None;
        self.create_page_with_id(id, meta)?;
        self.transact(id, |tx| {
            tx.set_db_property(&Property {
                id: TITLE.into(),
                name: "Name".into(),
                kind: PropType::Title,
                order: "a0".into(),
                options: vec![],
                relation: None,
                rollup: None,
            })?;
            tx.set_db_view(&View {
                id: new_id(),
                name: "Table".into(),
                kind: ViewKind::Table,
                order: "a0".into(),
                filters: vec![],
                sorts: vec![],
                group_by: None,
                hidden: vec![],
            })
        })?;
        Ok(id.to_string())
    }

    /// Turn an ordinary page into a database. Its text stays (shown above the table), and its
    /// sub-pages become the rows: same pages, same content, now with cells. Sub-pages that are
    /// databases themselves stay sub-pages. Columns and views from an earlier conversion are kept;
    /// otherwise it gets a Name column and a table view. Returns the ids of the new rows.
    pub fn convert_to_database(&mut self, page_id: &str) -> Result<Vec<PageId>> {
        let snap = self.snapshot(page_id)?;
        if snap.meta.kind == PageKind::Database {
            return Err(Error::Invalid("this page is already a database".into()));
        }
        if snap.meta.database_id.is_some() {
            return Err(Error::Invalid("a database row can't become a database".into()));
        }
        self.update_page(
            page_id,
            &PageMetaPatch {
                kind: Some(PageKind::Database),
                ..Default::default()
            },
        )?;
        // Now a database, its snapshot shows any columns and views kept from before.
        let def = self.database_def(page_id)?;
        if def.properties.iter().all(|p| p.id != TITLE) || def.views.is_empty() {
            self.transact(page_id, |tx| {
                if def.properties.iter().all(|p| p.id != TITLE) {
                    tx.set_db_property(&Property {
                        id: TITLE.into(),
                        name: "Name".into(),
                        kind: PropType::Title,
                        order: "a0".into(),
                        options: vec![],
                        relation: None,
                        rollup: None,
                    })?;
                }
                if def.views.is_empty() {
                    tx.set_db_view(&View {
                        id: new_id(),
                        name: "Table".into(),
                        kind: ViewKind::Table,
                        order: "a0".into(),
                        filters: vec![],
                        sorts: vec![],
                        group_by: None,
                        hidden: vec![],
                    })?;
                }
                Ok(())
            })?;
        }
        let children: Vec<_> = self
            .list_pages()?
            .into_iter()
            .filter(|p| p.parent_id.as_deref() == Some(page_id) && p.kind != "database" && p.database_id.is_none())
            .collect();
        let mut rows = Vec::new();
        for child in children {
            self.update_page(
                &child.id,
                &PageMetaPatch {
                    database_id: Some(Some(page_id.to_string())),
                    ..Default::default()
                },
            )?;
            rows.push(child.id);
        }
        Ok(rows)
    }

    /// Turn a database back into a page: the rows become ordinary sub-pages again. Their cell
    /// values and the columns stay stored, so converting back restores them.
    pub fn convert_to_page(&mut self, database_id: &str) -> Result<Vec<PageId>> {
        let snap = self.snapshot(database_id)?;
        if snap.meta.kind != PageKind::Database {
            return Err(Error::Invalid("this page is not a database".into()));
        }
        let rows: Vec<_> = self
            .list_pages()?
            .into_iter()
            .filter(|p| p.database_id.as_deref() == Some(database_id))
            .collect();
        let mut out = Vec::new();
        for row in rows {
            let mut patch = PageMetaPatch {
                database_id: Some(None),
                ..Default::default()
            };
            // Rows always live under their database; keep them there as sub-pages.
            if row.parent_id.as_deref() != Some(database_id) {
                patch.parent_id = Some(Some(database_id.to_string()));
            }
            self.update_page(&row.id, &patch)?;
            out.push(row.id);
        }
        self.update_page(
            database_id,
            &PageMetaPatch {
                kind: Some(PageKind::Page),
                ..Default::default()
            },
        )?;
        Ok(out)
    }

    /// The database definition, read from the live doc (not the index).
    pub fn database_def(&mut self, database_id: &str) -> Result<DatabaseDef> {
        let snap = self.snapshot(database_id)?;
        snap.database
            .ok_or_else(|| Error::Invalid(format!("{database_id} is not a database")))
    }

    /// Add or replace a column. Relations are created with [`Core::create_relation`].
    pub fn set_property(&mut self, database_id: &str, prop: Property) -> Result<()> {
        let def = self.database_def(database_id)?;
        let existing = def.property(&prop.id);
        if prop.id == TITLE && prop.kind != PropType::Title {
            return Err(Error::Invalid("the title column can't change type".into()));
        }
        if prop.kind == PropType::Title && prop.id != TITLE {
            return Err(Error::Invalid(
                "a database has exactly one title column".into(),
            ));
        }
        if prop.kind == PropType::Relation {
            match (existing.and_then(|p| p.relation.as_ref()), &prop.relation) {
                (Some(old), Some(new)) if old == new => {}
                _ => {
                    return Err(Error::Invalid(
                        "create relations with create_relation".into(),
                    ))
                }
            }
        }
        if let Some(r) = &prop.rollup {
            let rel = def.property(&r.relation);
            if !matches!(rel.map(|p| p.kind), Some(PropType::Relation)) {
                return Err(Error::Invalid(
                    "a rollup needs a relation column of this database".into(),
                ));
            }
        } else if prop.kind == PropType::Rollup {
            return Err(Error::Invalid("a rollup needs its configuration".into()));
        }
        let mut prop = prop;
        if prop.order.is_empty() {
            prop.order = existing.map(|p| p.order.clone()).unwrap_or_else(|| {
                key_after(def.properties.iter().map(|p| p.order.as_str()).max())
            });
        }
        self.transact(database_id, |tx| tx.set_db_property(&prop))
    }

    /// Create a relation column from `database_id` to another database, optionally two-way.
    /// Returns (column id, column id on the other database if two-way).
    pub fn create_relation(
        &mut self,
        database_id: &str,
        rel: &NewRelation,
    ) -> Result<(String, Option<String>)> {
        let def = self.database_def(database_id)?;
        let target = self.database_def(&rel.target_database)?;
        let id = new_id();
        let reverse_id = (rel.two_way && rel.target_database != database_id).then(new_id);
        let forward = Property {
            id: id.clone(),
            name: rel.name.clone(),
            kind: PropType::Relation,
            order: key_after(def.properties.iter().map(|p| p.order.as_str()).max()),
            options: vec![],
            relation: Some(RelationConfig {
                database_id: rel.target_database.clone(),
                synced_property: reverse_id.clone(),
                computed: false,
            }),
            rollup: None,
        };
        self.transact(database_id, |tx| tx.set_db_property(&forward))?;
        if let Some(rid) = &reverse_id {
            let reverse = Property {
                id: rid.clone(),
                name: rel
                    .reverse_name
                    .clone()
                    .unwrap_or_else(|| self.title_of(database_id)),
                kind: PropType::Relation,
                order: key_after(target.properties.iter().map(|p| p.order.as_str()).max()),
                options: vec![],
                relation: Some(RelationConfig {
                    database_id: database_id.to_string(),
                    synced_property: Some(id.clone()),
                    computed: true,
                }),
                rollup: None,
            };
            self.transact(&rel.target_database, |tx| tx.set_db_property(&reverse))?;
        }
        Ok((id, reverse_id))
    }

    /// Remove a column. Removing either side of a two-way relation removes the pair (the
    /// stored side holds the data, so without it the computed side would be empty anyway),
    /// and rollups built on a removed relation are removed with it, in either database.
    pub fn remove_property(&mut self, database_id: &str, prop_id: &str) -> Result<()> {
        if prop_id == TITLE {
            return Err(Error::Invalid("the title column can't be removed".into()));
        }
        let def = self.database_def(database_id)?;
        let prop = def
            .property(prop_id)
            .cloned()
            .ok_or_else(|| Error::Invalid(format!("no column {prop_id}")))?;
        self.remove_with_rollups(database_id, &def, prop_id)?;
        if let Some(RelationConfig {
            database_id: other,
            synced_property: Some(pair),
            ..
        }) = prop.relation
        {
            if let Ok(other_def) = self.database_def(&other) {
                if other_def.property(&pair).is_some() {
                    self.remove_with_rollups(&other, &other_def, &pair)?;
                }
            }
        }
        Ok(())
    }

    fn remove_with_rollups(
        &mut self,
        database_id: &str,
        def: &DatabaseDef,
        prop_id: &str,
    ) -> Result<()> {
        let dependents: Vec<String> = def
            .properties
            .iter()
            .filter(|p| p.rollup.as_ref().is_some_and(|r| r.relation == prop_id))
            .map(|p| p.id.clone())
            .collect();
        self.transact(database_id, |tx| {
            tx.remove_db_property(prop_id)?;
            dependents.iter().try_for_each(|d| tx.remove_db_property(d))
        })
    }

    pub fn set_view(&mut self, database_id: &str, mut view: View) -> Result<()> {
        let def = self.database_def(database_id)?;
        if view.order.is_empty() {
            view.order = def
                .views
                .iter()
                .find(|v| v.id == view.id)
                .map(|v| v.order.clone())
                .unwrap_or_else(|| key_after(def.views.iter().map(|v| v.order.as_str()).max()));
        }
        self.transact(database_id, |tx| tx.set_db_view(&view))
    }

    pub fn remove_view(&mut self, database_id: &str, view_id: &str) -> Result<()> {
        let def = self.database_def(database_id)?;
        if def.views.len() <= 1 {
            return Err(Error::Invalid("a database keeps at least one view".into()));
        }
        self.transact(database_id, |tx| tx.remove_db_view(view_id))
    }

    /// Add a row: a page in the database, with optional initial cell values.
    pub fn create_row(
        &mut self,
        database_id: &str,
        row_id: &str,
        title: &str,
        values: &BTreeMap<String, Value>,
    ) -> Result<PageId> {
        let def = self.database_def(database_id)?;
        let meta = PageMeta {
            title: title.to_string(),
            parent_id: Some(database_id.to_string()),
            database_id: Some(database_id.to_string()),
            key: format!("r{:013}", crate::store::now_millis()),
            ..Default::default()
        };
        self.create_page_with_id(row_id, meta)?;
        for (prop_id, value) in values {
            if def.property(prop_id).is_none() {
                return Err(Error::Invalid(format!("no column {prop_id}")));
            }
            self.set_value(row_id, prop_id, value.clone())?;
        }
        Ok(row_id.to_string())
    }

    /// Set one cell. For the computed side of a two-way relation, this edits the rows on the
    /// other side so the stored links say the same thing.
    pub fn set_value(&mut self, row_id: &str, prop_id: &str, value: Value) -> Result<()> {
        let meta = self.snapshot(row_id)?.meta;
        let database_id = meta
            .database_id
            .ok_or_else(|| Error::Invalid(format!("{row_id} is not a database row")))?;
        let def = self.database_def(&database_id)?;
        let prop = def
            .property(prop_id)
            .cloned()
            .ok_or_else(|| Error::Invalid(format!("no column {prop_id}")))?;
        let value = normalize_value(&prop, value)?;

        if prop.kind == PropType::Title {
            let title = value
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            return self.update_page(
                row_id,
                &PageMetaPatch {
                    title: Some(title),
                    ..Default::default()
                },
            );
        }
        if let Some(rel) = prop.relation.as_ref().filter(|r| r.computed) {
            let source_prop = rel
                .synced_property
                .clone()
                .ok_or_else(|| Error::Malformed("computed relation without a pair".into()))?;
            let wanted: Vec<String> = ids_of(value.as_ref());
            let current = self.reverse_links(&source_prop, row_id)?;
            for other in current.iter().filter(|c| !wanted.contains(c)) {
                self.edit_links(other, &source_prop, |ids| ids.retain(|i| i != row_id))?;
            }
            for other in wanted.iter().filter(|w| !current.contains(w)) {
                self.edit_links(other, &source_prop, |ids| ids.push(row_id.to_string()))?;
            }
            return Ok(());
        }
        let key = value_key(prop_id);
        self.transact(row_id, |tx| match value {
            Some(v) => tx.set_prop(row_id, &key, v),
            None => tx.remove_prop(row_id, &key),
        })
    }

    /// Change the stored relation list of one row.
    fn edit_links(
        &mut self,
        row_id: &str,
        prop_id: &str,
        f: impl FnOnce(&mut Vec<String>),
    ) -> Result<()> {
        let key = value_key(prop_id);
        let snap = self.snapshot(row_id)?;
        let mut ids = ids_of(snap.root().props.get(&key));
        f(&mut ids);
        ids.dedup();
        self.transact(row_id, |tx| {
            if ids.is_empty() {
                tx.remove_prop(row_id, &key)
            } else {
                tx.set_prop(row_id, &key, Value::from(ids))
            }
        })
    }

    fn title_of(&self, page_id: &str) -> String {
        self.conn()
            .query_row(
                "SELECT title FROM page_meta WHERE id = ?1",
                [page_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_default()
    }
}

pub(crate) fn ids_of(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => vec![],
    }
}
