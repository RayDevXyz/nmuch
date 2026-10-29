//! The database query engine: what a view shows.
//!
//! Rows and their stored cell values come from the SQL index in a couple of queries. Computed
//! columns are then filled in: the reverse side of two-way relations (the same links read
//! backwards, found with SQLite's `json_each`) and rollups. Finally the view's filters, sorts
//! and board grouping are applied. Rows are pages, so a database of a few thousand rows is a
//! few thousand small index rows; this is milliseconds.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::params;
use serde::Serialize;
use serde_json::Value;

use crate::core::Core;
use crate::database::{
    ids_of, value_key, DatabaseDef, Filter, FilterOp, PropType, Property, RollupConfig, RollupFn,
    View, ViewKind, TITLE,
};
use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowRef {
    pub id: String,
    pub title: String,
    pub icon: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Cell values by column id, computed columns included. Missing = empty.
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// The select option id, or `None` for rows without a value.
    pub id: Option<String>,
    pub name: String,
    pub color: String,
    pub rows: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseResult {
    pub database_id: String,
    pub title: String,
    pub icon: String,
    pub properties: Vec<Property>,
    pub views: Vec<View>,
    /// The view that was applied.
    pub view: View,
    /// Rows after the view's filters and sorts.
    pub rows: Vec<Row>,
    /// Board columns (only when the view groups by a select column).
    pub groups: Vec<Group>,
    /// Title and icon of every row a relation cell points at.
    pub related: BTreeMap<String, RowRef>,
    /// Total rows in the database before filtering.
    pub total: usize,
}

impl Core {
    /// Run a view of a database. `view_id = None` uses the first view; `view` (if given)
    /// replaces the saved view, so the UI can preview filter changes before saving.
    pub fn query_database(
        &mut self,
        database_id: &str,
        view_id: Option<&str>,
        view: Option<View>,
    ) -> Result<DatabaseResult> {
        let snap = self.snapshot(database_id)?;
        let def = snap
            .database
            .clone()
            .ok_or_else(|| Error::Invalid(format!("{database_id} is not a database")))?;
        let view = match (view, view_id) {
            (Some(v), _) => v,
            (None, Some(id)) => def
                .views
                .iter()
                .find(|v| v.id == id)
                .cloned()
                .ok_or_else(|| Error::Invalid(format!("no view {id}")))?,
            (None, None) => def.views.first().cloned().unwrap_or_else(default_view),
        };

        let mut rows = self.rows_with_values(database_id, &def)?;
        let total = rows.len();
        let mut related: BTreeMap<String, RowRef> = BTreeMap::new();

        // Relations: stored side (drop links to deleted/trashed rows) and computed side.
        for prop in def
            .properties
            .iter()
            .filter(|p| p.kind == PropType::Relation)
        {
            let Some(rel) = &prop.relation else { continue };
            let live = self.live_rows(&rel.database_id)?;
            if rel.computed {
                let Some(src) = &rel.synced_property else {
                    continue;
                };
                let reverse = self.reverse_index(src)?;
                for row in rows.iter_mut() {
                    let ids: Vec<String> = reverse
                        .get(&row.id)
                        .cloned()
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|i| live.contains_key(i))
                        .collect();
                    set_ids(row, &prop.id, ids);
                }
            } else {
                for row in rows.iter_mut() {
                    let ids: Vec<String> = ids_of(row.values.get(&prop.id))
                        .into_iter()
                        .filter(|i| live.contains_key(i))
                        .collect();
                    set_ids(row, &prop.id, ids);
                }
            }
            for row in &rows {
                for id in ids_of(row.values.get(&prop.id)) {
                    if let Some(r) = live.get(&id) {
                        related.insert(id.clone(), r.clone());
                    }
                }
            }
        }

        // Rollups.
        for prop in def.properties.iter().filter(|p| p.kind == PropType::Rollup) {
            let Some(cfg) = &prop.rollup else { continue };
            let Some(rel) = def.property(&cfg.relation).and_then(|p| p.relation.clone()) else {
                continue;
            };
            let target_def = self
                .snapshot(&rel.database_id)?
                .database
                .unwrap_or_default();
            let target_values = self.column_values(&rel.database_id, &target_def, &cfg.property)?;
            let target_prop = target_def.property(&cfg.property).cloned();
            for row in rows.iter_mut() {
                let ids = ids_of(row.values.get(&cfg.relation));
                let v = rollup(cfg, target_prop.as_ref(), &ids, &target_values);
                if !v.is_null() {
                    row.values.insert(prop.id.clone(), v);
                }
            }
        }

        // Filters and sorts.
        rows.retain(|row| view.filters.iter().all(|f| matches_filter(&def, row, f)));
        for s in view.sorts.iter().rev() {
            if let Some(p) = def.property(&s.property) {
                rows.sort_by(|a, b| {
                    let o = compare(p, a.values.get(&p.id), b.values.get(&p.id), &related);
                    if s.desc {
                        o.reverse()
                    } else {
                        o
                    }
                });
            }
        }

        let groups = match view.group_by.as_deref().and_then(|g| def.property(g)) {
            Some(p) if p.kind == PropType::Select && view.kind == ViewKind::Board => {
                let mut groups: Vec<Group> = p
                    .options
                    .iter()
                    .map(|o| Group {
                        id: Some(o.id.clone()),
                        name: o.name.clone(),
                        color: o.color.clone(),
                        rows: vec![],
                    })
                    .collect();
                let mut none = Group {
                    id: None,
                    name: format!("No {}", p.name),
                    color: String::new(),
                    rows: vec![],
                };
                for row in &rows {
                    let v = row.values.get(&p.id).and_then(|v| v.as_str());
                    match groups.iter_mut().find(|g| g.id.as_deref() == v) {
                        Some(g) => g.rows.push(row.id.clone()),
                        None => none.rows.push(row.id.clone()),
                    }
                }
                groups.insert(0, none);
                groups
            }
            _ => vec![],
        };

        Ok(DatabaseResult {
            database_id: database_id.to_string(),
            title: snap.meta.title,
            icon: snap.meta.icon,
            properties: def.properties,
            views: def.views,
            view,
            rows,
            groups,
            related,
            total,
        })
    }

    /// Rows that link to `row_id` through the stored relation column `source_prop`.
    pub(crate) fn reverse_links(&self, source_prop: &str, row_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn().prepare(
            "SELECT p.block_id FROM props p, json_each(p.value) j
             WHERE p.key = ?1 AND p.block_id = p.page_id AND j.value = ?2 ORDER BY p.block_id",
        )?;
        let ids = stmt
            .query_map(params![value_key(source_prop), row_id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(ids)
    }

    /// target row id -> rows linking to it through `source_prop`, in row order.
    fn reverse_index(&self, source_prop: &str) -> Result<HashMap<String, Vec<String>>> {
        let mut stmt = self.conn().prepare(
            "SELECT j.value, p.block_id FROM props p, json_each(p.value) j
             JOIN page_meta m ON m.id = p.block_id
             WHERE p.key = ?1 AND p.block_id = p.page_id AND m.trashed_at IS NULL
             ORDER BY m.sort_key, m.created_at, m.id",
        )?;
        let mut out: HashMap<String, Vec<String>> = HashMap::new();
        for row in stmt.query_map([value_key(source_prop)], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            let (target, source) = row?;
            out.entry(target).or_default().push(source);
        }
        Ok(out)
    }

    /// Live (not trashed) rows of a database: id -> title/icon.
    fn live_rows(&self, database_id: &str) -> Result<HashMap<String, RowRef>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, title, icon FROM page_meta WHERE database_id = ?1 AND trashed_at IS NULL",
        )?;
        let rows = stmt
            .query_map([database_id], |r| {
                Ok(RowRef {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    icon: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows.into_iter().map(|r| (r.id.clone(), r)).collect())
    }

    /// Every live row of a database with its stored cell values (title included).
    fn rows_with_values(&self, database_id: &str, def: &DatabaseDef) -> Result<Vec<Row>> {
        let conn = self.conn();
        let mut rows: Vec<Row> = conn
            .prepare(
                "SELECT id, title, icon, created_at, updated_at FROM page_meta
                 WHERE database_id = ?1 AND trashed_at IS NULL ORDER BY sort_key, created_at, id",
            )?
            .query_map([database_id], |r| {
                Ok(Row {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    icon: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    values: BTreeMap::new(),
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        let stored: HashSet<String> = def
            .properties
            .iter()
            .filter(|p| {
                !matches!(p.kind, PropType::Rollup | PropType::Title)
                    && !p.relation.as_ref().is_some_and(|r| r.computed)
            })
            .map(|p| value_key(&p.id))
            .collect();
        let mut by_row: HashMap<String, BTreeMap<String, Value>> = HashMap::new();
        let mut stmt = conn.prepare(
            "SELECT p.block_id, p.key, p.value FROM props p JOIN page_meta m ON m.id = p.block_id
             WHERE m.database_id = ?1 AND p.block_id = p.page_id AND p.key LIKE 'db.%'",
        )?;
        for r in stmt.query_map([database_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (row, key, value) = r?;
            if stored.contains(&key) {
                if let Ok(v) = serde_json::from_str::<Value>(&value) {
                    by_row
                        .entry(row)
                        .or_default()
                        .insert(key[3..].to_string(), v);
                }
            }
        }
        for row in rows.iter_mut() {
            row.values = by_row.remove(&row.id).unwrap_or_default();
            if !row.title.is_empty() {
                row.values
                    .insert(TITLE.into(), Value::String(row.title.clone()));
            }
        }
        Ok(rows)
    }

    /// One column of a database for every live row (for rollups): row id -> value.
    fn column_values(
        &self,
        database_id: &str,
        def: &DatabaseDef,
        prop_id: &str,
    ) -> Result<HashMap<String, Value>> {
        if prop_id == TITLE {
            return Ok(self
                .live_rows(database_id)?
                .into_iter()
                .map(|(id, r)| (id, Value::String(r.title)))
                .collect());
        }
        let Some(prop) = def.property(prop_id) else {
            return Ok(HashMap::new());
        };
        if prop.kind == PropType::Rollup || prop.relation.as_ref().is_some_and(|r| r.computed) {
            return Ok(HashMap::new()); // rollups of computed columns aren't supported (yet)
        }
        let mut stmt = self.conn().prepare(
            "SELECT p.block_id, p.value FROM props p JOIN page_meta m ON m.id = p.block_id
             WHERE m.database_id = ?1 AND p.key = ?2 AND p.block_id = p.page_id AND m.trashed_at IS NULL",
        )?;
        let mut out = HashMap::new();
        for r in stmt.query_map(params![database_id, value_key(prop_id)], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            let (id, v) = r?;
            if let Ok(v) = serde_json::from_str::<Value>(&v) {
                // Show select options by name in rollups.
                let v = match (&prop.kind, &v) {
                    (PropType::Select, Value::String(o)) => prop
                        .options
                        .iter()
                        .find(|x| &x.id == o)
                        .map(|x| Value::String(x.name.clone()))
                        .unwrap_or(v),
                    (PropType::MultiSelect, Value::Array(a)) => Value::Array(
                        a.iter()
                            .map(|o| {
                                prop.options
                                    .iter()
                                    .find(|x| Some(x.id.as_str()) == o.as_str())
                                    .map(|x| Value::String(x.name.clone()))
                                    .unwrap_or(o.clone())
                            })
                            .collect(),
                    ),
                    _ => v,
                };
                out.insert(id, v);
            }
        }
        Ok(out)
    }
}

fn default_view() -> View {
    View {
        id: String::new(),
        name: "Table".into(),
        kind: ViewKind::Table,
        order: String::new(),
        filters: vec![],
        sorts: vec![],
        group_by: None,
        hidden: vec![],
    }
}

fn set_ids(row: &mut Row, prop: &str, ids: Vec<String>) {
    if ids.is_empty() {
        row.values.remove(prop);
    } else {
        row.values.insert(prop.to_string(), Value::from(ids));
    }
}

fn is_empty(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => true,
        Some(Value::String(s)) => s.is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

fn rollup(
    cfg: &RollupConfig,
    target: Option<&Property>,
    ids: &[String],
    values: &HashMap<String, Value>,
) -> Value {
    let vals: Vec<&Value> = ids.iter().filter_map(|i| values.get(i)).collect();
    let nums: Vec<f64> = vals.iter().filter_map(|v| v.as_f64()).collect();
    // Whole numbers come back as integers (130, not 130.0), like stored values do.
    let num = |f: Option<f64>| match f {
        Some(x) if x.fract() == 0.0 && x.abs() < 9.007_199_254_740_992e15 => Value::from(x as i64),
        Some(x) => serde_json::Number::from_f64(x)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        None => Value::Null,
    };
    match cfg.function {
        RollupFn::Count => Value::from(ids.len()),
        RollupFn::CountValues => Value::from(vals.iter().filter(|v| !is_empty(Some(v))).count()),
        RollupFn::PercentChecked => {
            if ids.is_empty() || target.is_some_and(|t| t.kind != PropType::Checkbox) {
                Value::Null
            } else {
                let done = vals.iter().filter(|v| v.as_bool() == Some(true)).count();
                num(Some(done as f64 / ids.len() as f64))
            }
        }
        RollupFn::Sum => num((!nums.is_empty()).then(|| nums.iter().sum())),
        RollupFn::Average => {
            num((!nums.is_empty()).then(|| nums.iter().sum::<f64>() / nums.len() as f64))
        }
        RollupFn::Min => num(nums.iter().copied().reduce(f64::min)),
        RollupFn::Max => num(nums.iter().copied().reduce(f64::max)),
        RollupFn::ShowValues => {
            let mut out: Vec<Value> = Vec::new();
            for v in vals {
                match v {
                    Value::Array(a) => out.extend(a.iter().cloned()),
                    other => out.push((*other).clone()),
                }
            }
            if out.is_empty() {
                Value::Null
            } else {
                Value::Array(out)
            }
        }
    }
}

fn text_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.to_lowercase(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| text_of(Some(x)))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

fn matches_filter(def: &DatabaseDef, row: &Row, f: &Filter) -> bool {
    let Some(prop) = def.property(&f.property) else {
        return true;
    }; // stale filter: ignore
    let v = row.values.get(&prop.id);
    let list = matches!(v, Some(Value::Array(_)));
    match f.op {
        FilterOp::Empty => is_empty(v),
        FilterOp::NotEmpty => !is_empty(v),
        FilterOp::Is | FilterOp::IsNot => {
            let hit = match (&f.value, v) {
                (Value::Bool(want), _) => v.and_then(|x| x.as_bool()).unwrap_or(false) == *want,
                (Value::Number(want), Some(x)) => x.as_f64() == want.as_f64(),
                (Value::String(want), Some(Value::Array(a))) => {
                    a.iter().any(|x| x.as_str() == Some(want.as_str()))
                }
                (want, Some(x)) if !list => text_of(Some(x)) == text_of(Some(want)),
                _ => false,
            };
            hit == (f.op == FilterOp::Is)
        }
        FilterOp::Contains | FilterOp::NotContains => {
            let needle = text_of(Some(&f.value));
            let hit = match v {
                Some(Value::Array(a)) => a
                    .iter()
                    .any(|x| x.as_str().is_some_and(|s| s.to_lowercase() == needle)),
                _ => text_of(v).contains(&needle),
            };
            hit == (f.op == FilterOp::Contains)
        }
        FilterOp::Gt | FilterOp::Lt => {
            let o = match (v.and_then(|x| x.as_f64()), f.value.as_f64()) {
                (Some(a), Some(b)) => a.partial_cmp(&b),
                _ if v.is_none() => return false,
                _ => Some(text_of(v).cmp(&text_of(Some(&f.value)))),
            };
            o == Some(if f.op == FilterOp::Gt {
                Ordering::Greater
            } else {
                Ordering::Less
            })
        }
    }
}

/// Order two cells of one column. Empty cells always go last.
fn compare(
    p: &Property,
    a: Option<&Value>,
    b: Option<&Value>,
    related: &BTreeMap<String, crate::db_query::RowRef>,
) -> Ordering {
    match (is_empty(a), is_empty(b)) {
        (true, true) => return Ordering::Equal,
        (true, false) => {
            return if p.kind == PropType::Checkbox {
                Ordering::Less
            } else {
                Ordering::Greater
            }
        }
        (false, true) => {
            return if p.kind == PropType::Checkbox {
                Ordering::Greater
            } else {
                Ordering::Less
            }
        }
        _ => {}
    }
    let (a, b) = (a.unwrap(), b.unwrap());
    match p.kind {
        PropType::Select => {
            let pos = |v: &Value| {
                p.options
                    .iter()
                    .position(|o| Some(o.id.as_str()) == v.as_str())
                    .unwrap_or(usize::MAX)
            };
            pos(a).cmp(&pos(b))
        }
        PropType::Relation => {
            let first = |v: &Value| {
                ids_of(Some(v))
                    .first()
                    .and_then(|i| related.get(i))
                    .map(|r| r.title.to_lowercase())
                    .unwrap_or_default()
            };
            first(a).cmp(&first(b))
        }
        _ => match (a.as_f64(), b.as_f64()) {
            (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(Ordering::Equal),
            _ => text_of(Some(a)).cmp(&text_of(Some(b))),
        },
    }
}
