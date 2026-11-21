//! Two-way sync with a BrainWaves server (see `bw_core::sync` for how a round works).
//!
//! - **Server side** (`dispatch_server`): the commands a syncing app calls, over the normal
//!   API with an API token: `syncHello`, `syncChanges`, `syncPage`, `syncPush`, `syncDelete`.
//! - **App side** (the desktop): `syncConnect`, `syncNow`, `syncStatus`, `syncDisconnect`, and a
//!   background thread (`spawn`) that syncs after local changes and every half minute.
//!   The settings and progress live in the workspace (`sync_kv`), so they survive restarts.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use bw_core::sync::{sync_round, Changes, Cursor, Remote, Report, SyncState};
use bw_core::Core;
use serde::Deserialize;
use serde_json::{json, Value};

type Shared = Arc<Mutex<Core>>;

fn b64(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s).map_err(|e| format!("bad base64: {e}"))
}

fn arg<T: serde::de::DeserializeOwned>(a: &Value) -> Result<T, String> {
    serde_json::from_value(a.clone()).map_err(|e| format!("bad arguments: {e}"))
}

// ---------------------------------------------------------------- server side

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SincePage {
    page_id: String,
    #[serde(default)]
    state_vector: String,
    #[serde(default)]
    update: String,
}

/// The server's half of a sync. `None`: not a sync command.
pub fn dispatch_server(core: &mut Core, command: &str, a: &Value) -> Option<Result<Value, String>> {
    let e = |err: bw_core::Error| err.to_string();
    Some((|| -> Result<Value, String> {
        match command {
            "syncHello" => Ok(json!({ "workspaceId": core.workspace_id().map_err(e)?, "pages": core.page_ids().map_err(e)?.len() })),
            "syncChanges" => {
                #[derive(Deserialize)]
                struct A {
                    #[serde(default)]
                    since: Cursor,
                }
                let A { since } = arg(a)?;
                Ok(serde_json::to_value(core.changes_since(since).map_err(e)?).unwrap())
            }
            "syncPage" => {
                let p: SincePage = arg(a)?;
                let sv = core.state_vector(&p.page_id).map_err(e)?;
                let update = if core.page_exists(&p.page_id).map_err(e)? {
                    core.encode_update_for(&p.page_id, Some(&b64(&p.state_vector)?)).map_err(e)?
                } else {
                    vec![]
                };
                Ok(json!({ "update": B64.encode(update), "stateVector": B64.encode(sv) }))
            }
            "syncPush" => {
                let p: SincePage = arg(a)?;
                Ok(json!(core.apply_remote(&p.page_id, &b64(&p.update)?).map_err(e)?))
            }
            "syncDelete" => {
                #[derive(Deserialize)]
                struct A {
                    ids: Vec<String>,
                }
                let A { ids } = arg(a)?;
                let here: Vec<String> = ids.into_iter().filter(|id| core.page_exists(id).unwrap_or(false)).collect();
                core.delete_pages(&here).map_err(e)?;
                Ok(json!(here.len()))
            }
            _ => Err(String::new()),
        }
    })())
    .filter(|r| !matches!(r, Err(m) if m.is_empty()))
}

// ---------------------------------------------------------------- app side

/// A BrainWaves server, reached with an API token (Settings → Account → New token).
pub struct Http {
    url: String,
    token: String,
    agent: ureq::Agent,
}

impl Http {
    pub fn new(url: &str, token: &str) -> Self {
        let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(60)).build();
        Self { url: url.trim().trim_end_matches('/').to_string(), token: token.trim().to_string(), agent }
    }

    fn call(&self, command: &str, body: Value) -> Result<Value, String> {
        let res = self
            .agent
            .post(&format!("{}/api/{command}", self.url))
            .set("authorization", &format!("Bearer {}", self.token))
            .set("content-type", "application/json")
            .send_string(&body.to_string());
        match res {
            Ok(r) => {
                let text = r.into_string().map_err(|e| format!("Reading the server's answer failed: {e}"))?;
                serde_json::from_str(&text).map_err(|e| format!("The server sent something unexpected: {e}"))
            }
            Err(ureq::Error::Status(401, _)) => Err("The server refused the token. Make a new one in BrainWaves on the server: Settings → Account → New token.".into()),
            Err(ureq::Error::Status(code, r)) => {
                let text = r.into_string().unwrap_or_default();
                if code == 400 && text.contains("unknown command") {
                    Err("The server's BrainWaves is too old to sync: update it first.".into())
                } else {
                    Err(format!("The server answered {code}: {}", text.chars().take(200).collect::<String>()))
                }
            }
            Err(e) => Err(format!("Can't reach {}: {e}", self.url)),
        }
    }

    pub fn hello(&self) -> Result<(String, usize), String> {
        let v = self.call("syncHello", json!({}))?;
        Ok((v["workspaceId"].as_str().unwrap_or_default().to_string(), v["pages"].as_u64().unwrap_or(0) as usize))
    }
}

impl Remote for Http {
    fn changes(&mut self, since: Cursor) -> Result<Changes, String> {
        serde_json::from_value(self.call("syncChanges", json!({ "since": since }))?).map_err(|e| e.to_string())
    }
    fn page(&mut self, page_id: &str, sv: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        let v = self.call("syncPage", json!({ "pageId": page_id, "stateVector": B64.encode(sv) }))?;
        Ok((b64(v["update"].as_str().unwrap_or(""))?, b64(v["stateVector"].as_str().unwrap_or(""))?))
    }
    fn push(&mut self, page_id: &str, update: &[u8]) -> Result<bool, String> {
        Ok(self.call("syncPush", json!({ "pageId": page_id, "update": B64.encode(update) }))?.as_bool().unwrap_or(true))
    }
    fn delete(&mut self, page_ids: &[String]) -> Result<(), String> {
        self.call("syncDelete", json!({ "ids": page_ids })).map(|_| ())
    }
}

/// Only one sync at a time (the background thread and "Sync now").
static RUNNING: Mutex<()> = Mutex::new(());

fn get(core: &Shared, key: &str) -> Result<Option<String>, String> {
    core.lock().map_err(|e| e.to_string())?.sync_get(key).map_err(|e| e.to_string())
}

fn set(core: &Shared, key: &str, value: Option<&str>) -> Result<(), String> {
    core.lock().map_err(|e| e.to_string())?.sync_set(key, value).map_err(|e| e.to_string())
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Sync until a round finds nothing to do (at most a few rounds). Errors are also kept for
/// the status line.
pub fn sync_now(core: &Shared) -> Result<Report, String> {
    let _one = RUNNING.lock().map_err(|e| e.to_string())?;
    let (Some(url), Some(token)) = (get(core, "server_url")?, get(core, "server_token")?) else {
        return Err("Not connected to a server.".into());
    };
    let mut http = Http::new(&url, &token);
    let result = (|| -> Result<Report, String> {
        // A different server (or a reset one): start over, comparing every page.
        let (workspace, _) = http.hello()?;
        let mut state: SyncState = get(core, "state")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        if get(core, "server_workspace")?.as_deref() != Some(workspace.as_str()) {
            state = SyncState::default();
            set(core, "server_workspace", Some(&workspace))?;
        }
        let mut total = Report::default();
        for _ in 0..4 {
            let r = sync_round(core, &mut http, &mut state)?;
            set(core, "state", Some(&serde_json::to_string(&state).unwrap()))?;
            total.sent += r.sent;
            total.received += r.received;
            total.deleted_here += r.deleted_here;
            total.deleted_there += r.deleted_there;
            if r == Report::default() {
                break;
            }
        }
        Ok(total)
    })();
    match &result {
        Ok(r) => {
            set(core, "last_ok", Some(&now().to_string()))?;
            set(core, "last_error", None)?;
            set(core, "last_report", Some(&serde_json::to_string(r).unwrap()))?;
        }
        Err(e) => {
            set(core, "last_error", Some(e))?;
            set(core, "last_error_at", Some(&now().to_string()))?;
        }
    }
    result
}

pub fn status(core: &Shared) -> Result<Value, String> {
    let url = get(core, "server_url")?;
    let report: Option<Value> = get(core, "last_report")?.and_then(|s| serde_json::from_str(&s).ok());
    Ok(json!({
        "connected": url.is_some(),
        "url": url,
        "lastOk": get(core, "last_ok")?.and_then(|s| s.parse::<i64>().ok()),
        "lastError": get(core, "last_error")?,
        "lastReport": report,
        "running": RUNNING.try_lock().is_err(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectArgs {
    url: String,
    token: String,
    /// "merge": keep this computer's pages and add the server's (default).
    /// "server": replace this computer's pages with the server's.
    #[serde(default)]
    mode: String,
    /// Just check the server and count its pages; change nothing.
    #[serde(default)]
    check: bool,
}

fn connect(core: &Shared, a: &Value, wake: Option<&Sender<()>>) -> Result<Value, String> {
    let c: ConnectArgs = arg(a)?;
    let url = c.url.trim().trim_end_matches('/').to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("The server address starts with https:// (or http://).".into());
    }
    let http = Http::new(&url, &c.token);
    let (workspace, server_pages) = http.hello()?;
    let here = core.lock().map_err(|e| e.to_string())?.page_ids().map_err(|e| e.to_string())?.len();
    if c.check {
        return Ok(json!({ "serverPages": server_pages, "localPages": here }));
    }
    {
        let core_ = core.lock().map_err(|e| e.to_string())?;
        if workspace == core_.workspace_id().map_err(|e| e.to_string())? {
            return Err("That's this workspace itself.".into());
        }
    }
    let _one = RUNNING.lock().map_err(|e| e.to_string())?;
    let mut state = SyncState::default();
    if c.mode == "server" {
        // Start from the server's pages: this computer's are removed first (they never
        // reached the server, so nothing is sent about them).
        let mut core_ = core.lock().map_err(|e| e.to_string())?;
        let ids = core_.page_ids().map_err(|e| e.to_string())?;
        core_.delete_pages(&ids).map_err(|e| e.to_string())?;
        state.local = core_.sync_cursor().map_err(|e| e.to_string())?;
    }
    set(core, "server_url", Some(&url))?;
    set(core, "server_token", Some(c.token.trim()))?;
    set(core, "server_workspace", Some(&workspace))?;
    set(core, "state", Some(&serde_json::to_string(&state).unwrap()))?;
    set(core, "last_error", None)?;
    drop(_one);
    let report = sync_now(core)?;
    if let Some(w) = wake {
        let _ = w.send(());
    }
    Ok(json!({ "report": report }))
}

fn disconnect(core: &Shared) -> Result<Value, String> {
    let _one = RUNNING.lock().map_err(|e| e.to_string())?;
    for k in ["server_url", "server_token", "server_workspace", "state", "last_ok", "last_error", "last_error_at", "last_report"] {
        set(core, k, None)?;
    }
    Ok(json!(null))
}

/// Set by the host that runs the background sync, so "Sync now" and connecting can wake it.
static WAKE: Mutex<Option<Sender<()>>> = Mutex::new(None);

/// The app's sync commands; they wait on the network, so they run without the core's lock.
pub fn dispatch_unlocked(core: &Shared, command: &str, args: &Value) -> Option<Result<Value, String>> {
    let wake = WAKE.lock().ok().and_then(|w| w.clone());
    Some(match command {
        "syncConnect" => connect(core, args, wake.as_ref()),
        "syncNow" => sync_now(core).map(|r| json!(r)),
        "syncStatus" => status(core),
        "syncDisconnect" => disconnect(core),
        _ => return None,
    })
}

/// Sync in the background: a few seconds after local changes (`changed`), and every 30
/// seconds to pick up changes made elsewhere. Quiet when not connected; when the server can't
/// be reached it just tries again later (the status shows the error).
pub fn spawn(core: Shared, changed: Receiver<()>) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    if let Ok(mut w) = WAKE.lock() {
        *w = Some(tx.clone());
    }
    // Local changes come in bursts (typing): wait for a pause before syncing.
    std::thread::spawn(move || {
        while changed.recv().is_ok() {
            std::thread::sleep(Duration::from_secs(2));
            while changed.try_recv().is_ok() {}
            let _ = tx.send(());
        }
    });
    std::thread::spawn(move || loop {
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {
                while rx.try_recv().is_ok() {}
                if get(&core, "server_url").ok().flatten().is_some() {
                    let _ = sync_now(&core);
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    });
}
