//! Widgets: small apps embedded in pages that read and write databases through a narrow,
//! access-checked API.
//!
//! **The model.** A widget *definition* (installed once) has a manifest and its code. The
//! manifest declares named **slots** ("items", "courses"), each with an access level (read or
//! write) and the **fields** it needs, by type ("done: a Checkbox"). A widget *instance* is a
//! `widget` block in a page; its `bindings` attribute, set by the user, connects each slot to
//! one database and each field to one of that database's columns.
//!
//! **The rule.** A widget can reach exactly what its instance is bound to: the bound databases,
//! only the bound columns (plus the row title), and only with the access its manifest declared.
//! The core checks every call here, reading the bindings from the page's own Y.Doc, so neither
//! a widget nor a buggy host can widen them. Widgets address fields by their own keys and never
//! see column ids, or anything about other columns.

use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::Core;
use crate::database::{
    DatabaseDef, Filter, PropType, Property, SelectOption, Sort, View, ViewKind, TITLE,
};
use crate::db_query::RowRef;
use crate::error::{Error, Result};
use crate::schema::{new_id, node};
use crate::store::now_millis;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    Read,
    Write,
}

/// A column a slot needs, described by the types that will do.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSpec {
    #[serde(default)]
    pub label: String,
    pub types: Vec<PropType>,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotSpec {
    pub access: Access,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub fields: BTreeMap<String, FieldSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub slots: BTreeMap<String, SlotSpec>,
    /// Initial height in pixels (the widget can resize itself).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetDef {
    pub manifest: Manifest,
    /// The widget's code: one HTML document. Omitted in listings.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub html: String,
    pub builtin: bool,
    pub installed_at: i64,
}

/// What a widget instance's slot is connected to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub database_id: String,
    /// Field key (from the manifest) -> column id.
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
}

/// A query in the widget's own terms: filters and sorts name field keys, not column ids.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetQuery {
    pub filters: Vec<Filter>,
    pub sorts: Vec<Sort>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetField {
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: PropType,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SelectOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetRow {
    pub id: String,
    pub title: String,
    pub icon: String,
    /// Values by field key. Only bound fields appear.
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetResult {
    pub database: RowRef,
    pub fields: Vec<WidgetField>,
    pub rows: Vec<WidgetRow>,
    /// Titles of rows that bound relation fields point at.
    pub related: BTreeMap<String, RowRef>,
    /// Rows matching before `limit`.
    pub total: usize,
}

const MAX_HTML: usize = 2 * 1024 * 1024;

/// A JSON-valued block attribute. The editor stores objects as JSON text (an object attribute
/// would compare unequal to itself on every sync); plain objects are accepted too.
pub(crate) fn json_attr(attrs: &BTreeMap<String, Value>, key: &str) -> Option<Value> {
    match attrs.get(key)? {
        Value::String(s) => serde_json::from_str(s).ok(),
        v => Some(v.clone()),
    }
}

fn valid_key(k: &str) -> bool {
    let mut c = k.chars();
    matches!(c.next(), Some(f) if f.is_ascii_alphabetic())
        && c.all(|x| x.is_ascii_alphanumeric() || x == '_')
        && k.len() <= 40
}

/// Check a manifest before installing it.
pub fn validate_manifest(m: &Manifest) -> Result<()> {
    let bad = |why: String| Err(Error::Invalid(format!("widget manifest: {why}")));
    let id_ok = m.id.len() >= 2
        && m.id.len() <= 64
        && m.id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'))
        && m.id
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric());
    if !id_ok {
        return bad(format!(
            "id {:?} must be 2-64 characters of a-z, 0-9, '.', '-', '_'",
            m.id
        ));
    }
    if m.name.trim().is_empty() {
        return bad("name is required".into());
    }
    for (slot, spec) in &m.slots {
        if !valid_key(slot) {
            return bad(format!("slot name {slot:?} must be a simple identifier"));
        }
        for (field, f) in &spec.fields {
            if !valid_key(field) || field == TITLE {
                return bad(format!(
                    "field name {field:?} in slot {slot} is not allowed"
                ));
            }
            if f.types.is_empty() {
                return bad(format!(
                    "field {field} in slot {slot} must list at least one type"
                ));
            }
        }
    }
    Ok(())
}

impl Core {
    // ------------------------------------------------------------------ definitions

    /// Install (or update) a widget definition.
    pub fn install_widget(&mut self, manifest: &Manifest, html: &str, builtin: bool) -> Result<()> {
        validate_manifest(manifest)?;
        if html.len() > MAX_HTML {
            return Err(Error::Invalid("widget code is larger than 2 MB".into()));
        }
        let json = serde_json::to_string(manifest).map_err(|e| Error::Invalid(e.to_string()))?;
        self.conn().execute(
            "INSERT INTO widget_defs(id, manifest, html, builtin, installed_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET manifest = excluded.manifest, html = excluded.html, builtin = excluded.builtin",
            params![manifest.id, json, html, builtin, now_millis()],
        )?;
        Ok(())
    }

    pub fn remove_widget(&mut self, id: &str) -> Result<()> {
        self.conn()
            .execute("DELETE FROM widget_defs WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Installed widgets, without their code.
    pub fn list_widgets(&self) -> Result<Vec<WidgetDef>> {
        let mut stmt = self.conn().prepare(
            "SELECT manifest, builtin, installed_at FROM widget_defs ORDER BY builtin DESC, id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .filter_map(|(m, builtin, installed_at)| {
                serde_json::from_str(&m).ok().map(|manifest| WidgetDef {
                    manifest,
                    html: String::new(),
                    builtin,
                    installed_at,
                })
            })
            .collect())
    }

    pub fn widget_def(&self, id: &str) -> Result<WidgetDef> {
        let row = self
            .conn()
            .query_row(
                "SELECT manifest, html, builtin, installed_at FROM widget_defs WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, bool>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?;
        let (m, html, builtin, installed_at) =
            row.ok_or_else(|| Error::Invalid(format!("widget {id} is not installed")))?;
        let manifest = serde_json::from_str(&m).map_err(|e| Error::Malformed(e.to_string()))?;
        Ok(WidgetDef {
            manifest,
            html,
            builtin,
            installed_at,
        })
    }

    // ------------------------------------------------------------------ the checked API

    /// The manifest and bindings of the widget block `block_id` on `page_id`, read from the
    /// page's own document.
    fn widget_instance(
        &mut self,
        page_id: &str,
        block_id: &str,
    ) -> Result<(Manifest, BTreeMap<String, Binding>)> {
        let snap = self.snapshot(page_id)?;
        let block = snap
            .get(block_id)
            .filter(|b| b.flavour == node::WIDGET)
            .ok_or_else(|| {
                Error::Forbidden(format!("there is no widget {block_id} on this page"))
            })?;
        let def_id = block
            .attrs
            .get("widget")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let manifest = self.widget_def(&def_id)?.manifest;
        let bindings = json_attr(&block.attrs, "bindings")
            .and_then(|b| serde_json::from_value::<BTreeMap<String, Binding>>(b).ok())
            .unwrap_or_default();
        Ok((manifest, bindings))
    }

    /// Resolve a slot: its spec, its database and its fields (field key -> column), checking
    /// that every bound column exists and has an allowed type.
    fn widget_slot(
        &mut self,
        page_id: &str,
        block_id: &str,
        slot: &str,
    ) -> Result<(SlotSpec, Binding, DatabaseDef, BTreeMap<String, Property>)> {
        let (manifest, bindings) = self.widget_instance(page_id, block_id)?;
        let spec =
            manifest.slots.get(slot).cloned().ok_or_else(|| {
                Error::Forbidden(format!("{} has no slot {slot:?}", manifest.name))
            })?;
        let binding = bindings.get(slot).cloned().ok_or_else(|| {
            Error::Forbidden(format!("slot {slot:?} is not connected to a database yet"))
        })?;
        let def = self.database_def(&binding.database_id)?;
        let mut fields = BTreeMap::new();
        if let Some(t) = def.property(TITLE) {
            fields.insert(TITLE.to_string(), t.clone());
        }
        for (key, f) in &spec.fields {
            match binding.fields.get(key).and_then(|pid| def.property(pid)) {
                Some(p) if f.types.contains(&p.kind) => {
                    fields.insert(key.clone(), p.clone());
                }
                Some(p) => {
                    return Err(Error::Forbidden(format!(
                        "field {key:?} is bound to {:?}, which is not one of the allowed types",
                        p.name
                    )))
                }
                None if f.optional => {}
                None => {
                    return Err(Error::Forbidden(format!(
                        "field {key:?} of slot {slot:?} is not connected to a column"
                    )))
                }
            }
        }
        Ok((spec, binding, def, fields))
    }

    /// Read a slot's rows, in the widget's terms.
    pub fn widget_query(
        &mut self,
        page_id: &str,
        block_id: &str,
        slot: &str,
        q: &WidgetQuery,
    ) -> Result<WidgetResult> {
        let (_, binding, _, fields) = self.widget_slot(page_id, block_id, slot)?;
        let col = |key: &str| {
            fields
                .get(key)
                .map(|p| p.id.clone())
                .ok_or_else(|| Error::Forbidden(format!("{key:?} is not a field of slot {slot:?}")))
        };
        let view = View {
            id: String::new(),
            name: String::new(),
            kind: ViewKind::Table,
            order: String::new(),
            filters: q
                .filters
                .iter()
                .map(|f| {
                    Ok(Filter {
                        property: col(&f.property)?,
                        ..f.clone()
                    })
                })
                .collect::<Result<_>>()?,
            sorts: q
                .sorts
                .iter()
                .map(|s| {
                    Ok(Sort {
                        property: col(&s.property)?,
                        ..s.clone()
                    })
                })
                .collect::<Result<_>>()?,
            group_by: None,
            hidden: vec![],
        };
        let r = self.query_database(&binding.database_id, None, Some(view))?;

        let matched = r.rows.len();
        let mut related = BTreeMap::new();
        let rows: Vec<WidgetRow> = r
            .rows
            .into_iter()
            .take(q.limit.unwrap_or(usize::MAX))
            .map(|row| {
                let values = fields
                    .iter()
                    .filter_map(|(key, p)| row.values.get(&p.id).map(|v| (key.clone(), v.clone())))
                    .collect::<BTreeMap<_, _>>();
                for (key, v) in &values {
                    if fields
                        .get(key)
                        .is_some_and(|p| p.kind == PropType::Relation)
                    {
                        for id in crate::database::ids_of(Some(v)) {
                            if let Some(rr) = r.related.get(&id) {
                                related.insert(id, rr.clone());
                            }
                        }
                    }
                }
                WidgetRow {
                    id: row.id,
                    title: row.title,
                    icon: row.icon,
                    values,
                }
            })
            .collect();
        Ok(WidgetResult {
            database: RowRef {
                id: binding.database_id.clone(),
                title: r.title,
                icon: r.icon,
            },
            fields: fields
                .into_iter()
                .map(|(key, p)| WidgetField {
                    key,
                    name: p.name,
                    kind: p.kind,
                    options: p.options,
                })
                .collect(),
            rows,
            related,
            total: matched,
        })
    }

    /// Change cells of one row through a write slot. `patch` is keyed by field key ("title"
    /// renames the row).
    pub fn widget_mutate(
        &mut self,
        page_id: &str,
        block_id: &str,
        slot: &str,
        row_id: &str,
        patch: &BTreeMap<String, Value>,
    ) -> Result<()> {
        let (spec, binding, _, fields) = self.widget_slot(page_id, block_id, slot)?;
        if spec.access != Access::Write {
            return Err(Error::Forbidden(format!("slot {slot:?} is read-only")));
        }
        let row_db = self.snapshot(row_id).ok().and_then(|s| s.meta.database_id);
        if row_db.as_deref() != Some(binding.database_id.as_str()) {
            return Err(Error::Forbidden(format!(
                "row {row_id} is not in the database bound to {slot:?}"
            )));
        }
        let cols = patch
            .keys()
            .map(|k| {
                fields.get(k).map(|p| p.id.clone()).ok_or_else(|| {
                    Error::Forbidden(format!("{k:?} is not a field of slot {slot:?}"))
                })
            })
            .collect::<Result<Vec<_>>>()?;
        for (col, value) in cols.iter().zip(patch.values()) {
            self.set_value(row_id, col, value.clone())?;
        }
        Ok(())
    }

    /// Add a row through a write slot. Returns the new row's id.
    pub fn widget_create_row(
        &mut self,
        page_id: &str,
        block_id: &str,
        slot: &str,
        values: &BTreeMap<String, Value>,
    ) -> Result<String> {
        let (spec, binding, _, fields) = self.widget_slot(page_id, block_id, slot)?;
        if spec.access != Access::Write {
            return Err(Error::Forbidden(format!("slot {slot:?} is read-only")));
        }
        let mut cols = BTreeMap::new();
        let mut title = String::new();
        for (k, v) in values {
            let p = fields.get(k).ok_or_else(|| {
                Error::Forbidden(format!("{k:?} is not a field of slot {slot:?}"))
            })?;
            if p.id == TITLE {
                title = v.as_str().unwrap_or_default().to_string();
            } else {
                cols.insert(p.id.clone(), v.clone());
            }
        }
        let id = new_id();
        self.create_row(&binding.database_id, &id, &title, &cols)?;
        Ok(id)
    }
}
