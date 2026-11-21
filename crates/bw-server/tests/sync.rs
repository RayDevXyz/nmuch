//! A desktop workspace syncing with the hosted server over real HTTP, with an API token.

use std::sync::{Arc, Mutex};

use bw_core::{Core, PageMeta, PageMetaPatch};
use serde_json::{json, Value};

async fn start() -> String {
    let dir = std::env::temp_dir().join(format!("bw-sync-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let web = dir.join("web");
    std::fs::create_dir_all(&web).unwrap();
    std::fs::write(web.join("index.html"), "<!doctype html><title>BrainWaves</title>").unwrap();
    let app = bw_server::app(bw_server::Config { data: dir.join("data"), web, trust_proxy: false });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap() });
    format!("http://{addr}")
}

/// A desktop app's call (they block on the network, so off the async runtime).
async fn desk(core: &Arc<Mutex<Core>>, command: &str, args: Value) -> Result<Value, String> {
    let (core, command) = (core.clone(), command.to_string());
    tokio::task::spawn_blocking(move || bw_api::dispatch_unlocked(&core, &command, &args).expect("a sync command")).await.unwrap()
}

fn titles(core: &Arc<Mutex<Core>>) -> Vec<String> {
    let mut t: Vec<String> = core.lock().unwrap().list_pages().unwrap().into_iter().filter(|p| p.trashed_at.is_none()).map(|p| p.title).collect();
    t.sort();
    t
}

#[tokio::test]
async fn desktop_and_server_sync_both_ways() {
    let base = start().await;
    let me = reqwest::Client::builder().cookie_store(true).build().unwrap();
    me.post(format!("{base}/api/auth/setup")).json(&json!({ "name": "Ray", "password": "correct horse battery" })).send().await.unwrap();
    let t: Value = me.post(format!("{base}/api/auth/tokens")).json(&json!({ "name": "Laptop" })).send().await.unwrap().json().await.unwrap();
    let token = t["token"].as_str().unwrap().to_string();
    let server = |cmd: &str, args: Value| {
        let (me, url) = (me.clone(), format!("{base}/api/{cmd}"));
        async move { me.post(url).json(&args).send().await.unwrap().json::<Value>().await.unwrap() }
    };
    let server_titles = || async {
        let mut t: Vec<String> = server("listPages", json!({})).await.as_array().unwrap().iter().filter(|p| p["trashedAt"].is_null()).map(|p| p["title"].as_str().unwrap().to_string()).collect();
        t.sort();
        t
    };
    server("createPage", json!({ "id": "s1", "meta": { "title": "From the phone", "key": "a0" } })).await;

    let laptop = Arc::new(Mutex::new(Core::open_in_memory().unwrap()));
    laptop.lock().unwrap().create_page_with_id("d1", PageMeta { title: "From the laptop".into(), ..Default::default() }).unwrap();

    // A wrong token is explained; "check" counts pages without changing anything.
    let err = desk(&laptop, "syncConnect", json!({ "url": base, "token": "bw_wrong" })).await.unwrap_err();
    assert!(err.contains("refused the token"), "{err}");
    let c = desk(&laptop, "syncConnect", json!({ "url": format!("{base}/"), "token": token, "check": true })).await.unwrap();
    assert_eq!((c["serverPages"].as_u64(), c["localPages"].as_u64()), (Some(1), Some(1)));

    // Merge: both sides get both pages.
    let r = desk(&laptop, "syncConnect", json!({ "url": base, "token": token, "mode": "merge" })).await.unwrap();
    assert_eq!(r["report"]["received"], 1, "{r}");
    assert_eq!(titles(&laptop), ["From the laptop", "From the phone"]);
    assert_eq!(server_titles().await, ["From the laptop", "From the phone"]);

    // Edits on each side reach the other.
    laptop.lock().unwrap().update_page("d1", &PageMetaPatch { title: Some("Renamed on the laptop".into()), ..Default::default() }).unwrap();
    server("updatePage", json!({ "id": "s1", "patch": { "icon": "📱" } })).await;
    let r = desk(&laptop, "syncNow", json!({})).await.unwrap();
    assert!(r["sent"].as_u64().unwrap() >= 1 && r["received"].as_u64().unwrap() >= 1, "{r}");
    assert_eq!(server_titles().await, ["From the phone", "Renamed on the laptop"]);
    assert_eq!(laptop.lock().unwrap().snapshot("s1").unwrap().meta.icon, "📱");

    // Delete forever on the server: gone on the laptop too.
    server("deletePages", json!({ "ids": ["s1"] })).await;
    desk(&laptop, "syncNow", json!({})).await.unwrap();
    assert_eq!(titles(&laptop), ["Renamed on the laptop"]);

    let st = desk(&laptop, "syncStatus", json!({})).await.unwrap();
    assert_eq!(st["connected"], true);
    assert!(st["lastOk"].as_i64().unwrap() > 0 && st["lastError"].is_null(), "{st}");

    // Another computer that starts from the server's pages: its own starter page goes away
    // and never reaches the server.
    let pc = Arc::new(Mutex::new(Core::open_in_memory().unwrap()));
    pc.lock().unwrap().create_page_with_id("x", PageMeta { title: "Getting Started".into(), ..Default::default() }).unwrap();
    desk(&pc, "syncConnect", json!({ "url": base, "token": token, "mode": "server" })).await.unwrap();
    assert_eq!(titles(&pc), ["Renamed on the laptop"]);
    assert_eq!(server_titles().await, ["Renamed on the laptop"]);

    // Disconnected: status says so, and sync refuses politely.
    desk(&pc, "syncDisconnect", json!({})).await.unwrap();
    assert_eq!(desk(&pc, "syncStatus", json!({})).await.unwrap()["connected"], false);
    assert!(desk(&pc, "syncNow", json!({})).await.unwrap_err().contains("Not connected"));
}
