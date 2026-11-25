//! The frontend's view of the core: a single `dispatch(command, args)` entry point.
//!
//! The Tauri app exposes it as one `core_call` command and the dev server as
//! `POST /api/<command>`, so the frontend talks to both through the same small client
//! (`apps/desktop/src/lib/core/`). Binary yrs updates travel as base64 strings.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use bw_core::{Core, Manifest, NewRelation, PageMeta, PageMetaPatch, Property, View, WidgetQuery};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;

pub mod burrow;
pub mod fivee;
pub mod gemini;
mod modules_api;
pub mod nimbus;
pub mod sync;
pub mod table;
pub mod watch;

pub use bw_core::Event;

/// Things only the host (Tauri app or dev server) knows.
#[derive(Debug, Clone, Default)]
pub struct Context {
    /// Where an old Nimbus database is expected (`<app data>/app.nimbus.notes/nimbus.db`).
    pub nimbus_db: Option<PathBuf>,
    /// Open files in their default app when a module asks (and is allowed). Off in tests.
    pub open_files: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageArg {
    page_id: String,
}

#[derive(Deserialize)]
struct CreatePage {
    id: String,
    #[serde(default)]
    meta: PageMeta,
}

#[derive(Deserialize)]
struct UpdatePage {
    id: String,
    patch: PageMetaPatch,
}

#[derive(Deserialize)]
struct Ids {
    ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushUpdate {
    page_id: String,
    update: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullUpdate {
    page_id: String,
    state_vector: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mentions {
    page_id: String,
    title: String,
}

#[derive(Deserialize)]
struct Tag {
    tag: String,
}

#[derive(Deserialize)]
struct Search {
    query: String,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    25
}

// ---- databases

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbArg {
    database_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryDb {
    database_id: String,
    #[serde(default)]
    view_id: Option<String>,
    #[serde(default)]
    view: Option<View>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetProperty {
    database_id: String,
    property: Property,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRelation {
    database_id: String,
    relation: NewRelation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveProperty {
    database_id: String,
    property_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetView {
    database_id: String,
    view: View,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveView {
    database_id: String,
    view_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRow {
    database_id: String,
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    values: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetValue {
    row_id: String,
    property_id: String,
    #[serde(default)]
    value: Value,
}

// ---- widgets

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallWidget {
    manifest: Manifest,
    html: String,
    #[serde(default)]
    builtin: bool,
}

#[derive(Deserialize)]
struct WidgetId {
    id: String,
}

/// Which widget instance is calling: always filled in by the host from where the widget is
/// mounted, never taken from the widget itself.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetCall {
    page_id: String,
    block_id: String,
    slot: String,
    #[serde(default)]
    query: Option<WidgetQuery>,
    #[serde(default)]
    row_id: Option<String>,
    #[serde(default)]
    values: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportPage {
    id: String,
    update: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NimbusPath {
    path: String,
    #[serde(default)]
    page_id: Option<String>,
}

fn args<T: DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("bad arguments: {e}"))
}

fn ok<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn b64(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s).map_err(|e| format!("bad base64: {e}"))
}

/// Run one command against the core. Errors come back as strings for the frontend.
/// Commands a host runs before taking the core's lock, because they wait on the network
/// (5etools, Burrow). `None`: an ordinary command; take the lock and call [`dispatch`].
pub fn dispatch_unlocked(core: &std::sync::Arc<std::sync::Mutex<Core>>, command: &str, args: &Value) -> Option<Result<Value, String>> {
    fivee::dispatch_unlocked(core, command, args)
        .or_else(|| gemini::dispatch_unlocked(core, command, args))
        .or_else(|| burrow::dispatch_unlocked(core, command, args))
        .or_else(|| sync::dispatch_unlocked(core, command, args))
        .or_else(|| table::dispatch_unlocked(command, args))
}

pub fn dispatch(core: &mut Core, ctx: &Context, command: &str, a: Value) -> Result<Value, String> {
    if let Some(r) = sync::dispatch_server(core, command, &a) {
        return r;
    }
    let e = |err: bw_core::Error| err.to_string();
    match command {
        "listPages" => ok(core.list_pages().map_err(e)?),
        "createPage" => {
            let CreatePage { id, meta } = args(a)?;
            ok(core.create_page_with_id(&id, meta).map_err(e)?)
        }
        "updatePage" => {
            let UpdatePage { id, patch } = args(a)?;
            core.update_page(&id, &patch).map_err(e)?;
            ok(())
        }
        "deletePages" => {
            let Ids { ids } = args(a)?;
            core.delete_pages(&ids).map_err(e)?;
            ok(())
        }
        "loadPage" => {
            let PageArg { page_id } = args(a)?;
            ok(B64.encode(core.encode_update_for(&page_id, None).map_err(e)?))
        }
        "pushUpdate" => {
            let PushUpdate { page_id, update } = args(a)?;
            core.apply_update(&page_id, &b64(&update)?).map_err(e)?;
            ok(())
        }
        "pullUpdate" => {
            let PullUpdate {
                page_id,
                state_vector,
            } = args(a)?;
            ok(B64.encode(
                core.encode_update_for(&page_id, Some(&b64(&state_vector)?))
                    .map_err(e)?,
            ))
        }
        "backlinks" => {
            let PageArg { page_id } = args(a)?;
            ok(core.backlinks(&page_id).map_err(e)?)
        }
        "mentions" => {
            let Mentions { page_id, title } = args(a)?;
            ok(core.mentions(&page_id, &title).map_err(e)?)
        }
        "links" => ok(core.links().map_err(e)?),
        "tags" => ok(core.tags().map_err(e)?),
        "pagesWithTag" => {
            let Tag { tag } = args(a)?;
            ok(core.pages_with_tag(&tag).map_err(e)?)
        }
        "search" => {
            let Search { query, limit } = args(a)?;
            ok(core.search(&query, limit).map_err(e)?)
        }
        "blockInfos" => {
            let Ids { ids } = args(a)?;
            ok(core.block_infos(&ids).map_err(e)?)
        }
        "dbPath" => ok(core
            .path()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ":memory:".into())),
        "rebuildIndex" => {
            let r = core.rebuild_index().map_err(e)?;
            ok(
                json!({ "pages": r.pages, "blocks": r.blocks, "updatesReplayed": r.updates_replayed, "ms": r.elapsed.as_millis() as u64 }),
            )
        }
        // ---- databases (see bw_core::database)
        "createDatabase" => {
            let CreatePage { id, meta } = args(a)?;
            ok(core.create_database(&id, meta).map_err(e)?)
        }
        "convertToDatabase" => {
            let PageArg { page_id } = args(a)?;
            ok(core.convert_to_database(&page_id).map_err(e)?)
        }
        "convertToPage" => {
            let DbArg { database_id } = args(a)?;
            ok(core.convert_to_page(&database_id).map_err(e)?)
        }
        "databaseDef" => {
            let DbArg { database_id } = args(a)?;
            ok(core.database_def(&database_id).map_err(e)?)
        }
        "queryDatabase" => {
            let QueryDb {
                database_id,
                view_id,
                view,
            } = args(a)?;
            ok(core
                .query_database(&database_id, view_id.as_deref(), view)
                .map_err(e)?)
        }
        "setProperty" => {
            let SetProperty {
                database_id,
                property,
            } = args(a)?;
            core.set_property(&database_id, property).map_err(e)?;
            ok(())
        }
        "createRelation" => {
            let CreateRelation {
                database_id,
                relation,
            } = args(a)?;
            let (id, reverse) = core.create_relation(&database_id, &relation).map_err(e)?;
            ok(json!({ "propertyId": id, "reversePropertyId": reverse }))
        }
        "removeProperty" => {
            let RemoveProperty {
                database_id,
                property_id,
            } = args(a)?;
            core.remove_property(&database_id, &property_id)
                .map_err(e)?;
            ok(())
        }
        "setDatabaseTemplate" => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct A {
                database_id: String,
                #[serde(default)]
                template_id: Option<String>,
            }
            let A { database_id, template_id } = args(a)?;
            core.set_database_template(&database_id, template_id.as_deref()).map_err(e)?;
            ok(())
        }
        "databaseTemplate" => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct A {
                database_id: String,
            }
            let A { database_id } = args(a)?;
            ok(core.database_template(&database_id).map_err(e)?)
        }
        "setView" => {
            let SetView { database_id, view } = args(a)?;
            core.set_view(&database_id, view).map_err(e)?;
            ok(())
        }
        "removeView" => {
            let RemoveView {
                database_id,
                view_id,
            } = args(a)?;
            core.remove_view(&database_id, &view_id).map_err(e)?;
            ok(())
        }
        "createRow" => {
            let CreateRow {
                database_id,
                id,
                title,
                values,
            } = args(a)?;
            ok(core
                .create_row(&database_id, &id, &title, &values)
                .map_err(e)?)
        }
        "setValue" => {
            let SetValue {
                row_id,
                property_id,
                value,
            } = args(a)?;
            core.set_value(&row_id, &property_id, value).map_err(e)?;
            ok(())
        }
        // ---- widgets (see bw_core::widgets)
        "listWidgets" => ok(core.list_widgets().map_err(e)?),
        "widgetDef" => {
            let WidgetId { id } = args(a)?;
            ok(core.widget_def(&id).map_err(e)?)
        }
        "installWidget" => {
            let InstallWidget {
                manifest,
                html,
                builtin,
            } = args(a)?;
            core.install_widget(&manifest, &html, builtin).map_err(e)?;
            ok(())
        }
        "removeWidget" => {
            let WidgetId { id } = args(a)?;
            core.remove_widget(&id).map_err(e)?;
            ok(())
        }
        "widgetQuery" => {
            let c: WidgetCall = args(a)?;
            ok(core
                .widget_query(
                    &c.page_id,
                    &c.block_id,
                    &c.slot,
                    &c.query.unwrap_or_default(),
                )
                .map_err(e)?)
        }
        "widgetMutate" => {
            let c: WidgetCall = args(a)?;
            let row = c.row_id.ok_or("rowId is required")?;
            core.widget_mutate(&c.page_id, &c.block_id, &c.slot, &row, &c.values)
                .map_err(e)?;
            ok(())
        }
        "widgetCreateRow" => {
            let c: WidgetCall = args(a)?;
            ok(core
                .widget_create_row(&c.page_id, &c.block_id, &c.slot, &c.values)
                .map_err(e)?)
        }
        "importPage" => {
            let ImportPage {
                id,
                update,
                created_at,
                updated_at,
            } = args(a)?;
            core.import_page(&id, &b64(&update)?, created_at, updated_at)
                .map_err(e)?;
            ok(())
        }
        // ---- reading an old Nimbus database (read-only; see nimbus.rs)
        "nimbusDefaultPath" => ok(ctx
            .nimbus_db
            .as_ref()
            .filter(|p| p.is_file())
            .map(|p| p.display().to_string())),
        "nimbusPages" => {
            let NimbusPath { path, .. } = args(a)?;
            ok(nimbus::pages(std::path::Path::new(&path))?)
        }
        "nimbusBlocks" => {
            let NimbusPath { path, page_id } = args(a)?;
            let page_id = page_id.ok_or("pageId is required")?;
            ok(nimbus::blocks(std::path::Path::new(&path), &page_id)?)
        }
        other => modules_api::dispatch(core, ctx, other, a)
            .unwrap_or_else(|| Err(format!("unknown command: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_through_dispatch() {
        let mut core = Core::open_in_memory().unwrap();
        let id = dispatch(
            &mut core,
            &Context::default(),
            "createPage",
            json!({ "id": "p1", "meta": { "title": "Hello", "key": "a0" } }),
        )
        .unwrap();
        assert_eq!(id, json!("p1"));
        dispatch(
            &mut core,
            &Context::default(),
            "updatePage",
            json!({ "id": "p1", "patch": { "icon": "📚" } }),
        )
        .unwrap();
        let pages = dispatch(&mut core, &Context::default(), "listPages", json!({})).unwrap();
        assert_eq!(pages[0]["title"], "Hello");
        assert_eq!(pages[0]["icon"], "📚");
        assert_eq!(pages[0]["parentId"], Value::Null);

        let full = dispatch(
            &mut core,
            &Context::default(),
            "loadPage",
            json!({ "pageId": "p1" }),
        )
        .unwrap();
        assert!(!full.as_str().unwrap().is_empty());
        let err = dispatch(
            &mut core,
            &Context::default(),
            "pushUpdate",
            json!({ "pageId": "p1", "update": "!!" }),
        )
        .unwrap_err();
        assert!(err.contains("base64"));
        assert!(dispatch(&mut core, &Context::default(), "nope", json!({}))
            .unwrap_err()
            .contains("unknown command"));
    }
}

#[cfg(test)]
mod database_tests {
    use super::*;

    #[test]
    fn database_commands_round_trip() {
        let mut core = Core::open_in_memory().unwrap();
        let ctx = Context::default();
        let mut call = |c: &str, a: Value| dispatch(&mut core, &ctx, c, a);
        call(
            "createDatabase",
            json!({ "id": "db", "meta": { "title": "Lessons" } }),
        )
        .unwrap();
        call("setProperty", json!({ "databaseId": "db", "property": { "id": "done", "name": "Done", "type": "checkbox" } })).unwrap();
        call(
            "createRow",
            json!({ "databaseId": "db", "id": "r1", "title": "Intro", "values": { "done": true } }),
        )
        .unwrap();
        call(
            "setValue",
            json!({ "rowId": "r1", "propertyId": "title", "value": "Introduction" }),
        )
        .unwrap();
        let r = call("queryDatabase", json!({ "databaseId": "db" })).unwrap();
        assert_eq!(r["rows"][0]["title"], "Introduction");
        assert_eq!(r["rows"][0]["values"]["done"], true);
        assert_eq!(r["properties"][1]["type"], "checkbox");
        assert_eq!(r["view"]["type"], "table");
        let err = call(
            "setValue",
            json!({ "rowId": "r1", "propertyId": "done", "value": "maybe" }),
        )
        .unwrap_err();
        assert!(err.contains("Done expects"), "{err}");
    }
}
