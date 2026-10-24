//! The frontend's view of the core: a single `dispatch(command, args)` entry point.
//!
//! The Tauri app exposes it as one `core_call` command and the dev server as
//! `POST /api/<command>`, so the frontend talks to both through the same small client
//! (`apps/desktop/src/lib/core/`). Binary yrs updates travel as base64 strings.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use bw_core::{Core, PageMeta, PageMetaPatch};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

pub use bw_core::Event;

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
pub fn dispatch(core: &mut Core, command: &str, a: Value) -> Result<Value, String> {
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
        other => Err(format!("unknown command: {other}")),
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
            "createPage",
            json!({ "id": "p1", "meta": { "title": "Hello", "key": "a0" } }),
        )
        .unwrap();
        assert_eq!(id, json!("p1"));
        dispatch(
            &mut core,
            "updatePage",
            json!({ "id": "p1", "patch": { "icon": "📚" } }),
        )
        .unwrap();
        let pages = dispatch(&mut core, "listPages", json!({})).unwrap();
        assert_eq!(pages[0]["title"], "Hello");
        assert_eq!(pages[0]["icon"], "📚");
        assert_eq!(pages[0]["parentId"], Value::Null);

        let full = dispatch(&mut core, "loadPage", json!({ "pageId": "p1" })).unwrap();
        assert!(!full.as_str().unwrap().is_empty());
        let err = dispatch(
            &mut core,
            "pushUpdate",
            json!({ "pageId": "p1", "update": "!!" }),
        )
        .unwrap_err();
        assert!(err.contains("base64"));
        assert!(dispatch(&mut core, "nope", json!({}))
            .unwrap_err()
            .contains("unknown command"));
    }
}
