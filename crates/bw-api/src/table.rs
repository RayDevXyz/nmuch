//! The D&D table server, reached from BrainWaves' side instead of from the browser.
//!
//! Making a room is a cross-site request when the page runs in a browser (the table server is
//! another site), so a reverse proxy that mishandles the browser's CORS check breaks it. The
//! host makes the request itself; the live connection is a WebSocket, which isn't affected.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct CreateRoom {
    server: String,
    key: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    code: Option<String>,
}

fn create_room(args: &Value) -> Result<Value, String> {
    let a: CreateRoom = serde_json::from_value(args.clone()).map_err(|e| format!("bad arguments: {e}"))?;
    let server = a.server.trim().trim_end_matches('/');
    if !(server.starts_with("http://") || server.starts_with("https://")) || server.contains(char::is_whitespace) {
        return Err(format!("{server:?} is not an http(s) address"));
    }
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(20)).build();
    let res = agent
        .post(&format!("{server}/api/rooms"))
        .set("authorization", &format!("Bearer {}", a.key.trim()))
        .set("content-type", "application/json")
        .send_string(&json!({ "name": a.name, "code": a.code }).to_string());
    match res {
        Ok(r) => {
            let text = r.into_string().map_err(|e| e.to_string())?;
            serde_json::from_str(&text).map_err(|e| format!("The table server sent something unexpected: {e}"))
        }
        Err(ureq::Error::Status(401, _)) => Err("The table server refused the DM key.".into()),
        Err(ureq::Error::Status(code, r)) => Err(format!(
            "The table server answered {code}: {}",
            r.into_string().unwrap_or_default().chars().take(200).collect::<String>()
        )),
        // Marked so the app can fall back to asking from the browser.
        Err(e) => Err(format!("unreachable: Can't reach the table server at {server}: {e}")),
    }
}

/// `tableCreateRoom { server, key, name, code? }` → `{ code }`.
pub fn dispatch_unlocked(command: &str, args: &Value) -> Option<Result<Value, String>> {
    (command == "tableCreateRoom").then(|| create_room(args))
}
