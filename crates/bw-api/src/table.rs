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

#[derive(Deserialize)]
struct Send {
    server: String,
    key: String,
    method: String,
    path: String,
    /// JSON text (sent as is: a compendium category can be many megabytes).
    #[serde(default)]
    body: Option<String>,
}

/// Only the hub's own paths: a room's compendium and journal.
fn hub_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/api/rooms/") else { return false };
    let mut parts = rest.split('/');
    let code = parts.next().unwrap_or_default();
    if !(6..=32).contains(&code.len()) || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    let tail: Vec<&str> = parts.collect();
    let id_ok = |s: &str| (1..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    match tail.as_slice() {
        ["compendium"] | ["journal"] => true,
        ["compendium", cat] => cat.chars().all(|c| c.is_ascii_lowercase()) && !cat.is_empty() && cat.len() < 20,
        ["journal", id] => id_ok(id),
        _ => false,
    }
}

fn send(args: &Value) -> Result<Value, String> {
    let a: Send = serde_json::from_value(args.clone()).map_err(|e| format!("bad arguments: {e}"))?;
    let server = a.server.trim().trim_end_matches('/');
    if !(server.starts_with("http://") || server.starts_with("https://")) || server.contains(char::is_whitespace) {
        return Err(format!("{server:?} is not an http(s) address"));
    }
    if !hub_path(&a.path) {
        return Err(format!("{} is not a table hub address", a.path));
    }
    let method = a.method.to_ascii_uppercase();
    if !["GET", "PUT", "DELETE"].contains(&method.as_str()) {
        return Err(format!("{method} is not allowed"));
    }
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(120)).build();
    let req = agent
        .request(&method, &format!("{server}{}", a.path))
        .set("authorization", &format!("Bearer {}", a.key.trim()))
        .set("content-type", "application/json");
    let res = match a.body {
        Some(b) => req.send_string(&b),
        None => req.call(),
    };
    match res {
        Ok(r) => {
            let text = r.into_string().map_err(|e| e.to_string())?;
            Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) })
        }
        Err(ureq::Error::Status(401, _)) => Err("The table server refused the DM key.".into()),
        Err(ureq::Error::Status(404, _)) => Err("The table server doesn't know this campaign's room. Go live once, then try again.".into()),
        Err(ureq::Error::Status(code, r)) => Err(format!(
            "The table server answered {code}: {}",
            r.into_string().unwrap_or_default().chars().take(200).collect::<String>()
        )),
        Err(e) => Err(format!("unreachable: Can't reach the table server at {server}: {e}")),
    }
}

/// `tableCreateRoom { server, key, name, code? }` → `{ code }`;
/// `tableSend { server, key, method, path, body? }` → the answer (hub paths only).
pub fn dispatch_unlocked(command: &str, args: &Value) -> Option<Result<Value, String>> {
    match command {
        "tableCreateRoom" => Some(create_room(args)),
        "tableSend" => Some(send(args)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_hub_paths() {
        use super::hub_path;
        assert!(hub_path("/api/rooms/AbCdEf1234/compendium"));
        assert!(hub_path("/api/rooms/AbCdEf1234/compendium/spell"));
        assert!(hub_path("/api/rooms/AbCdEf1234/journal/page-1"));
        assert!(!hub_path("/api/rooms"));
        assert!(!hub_path("/api/rooms/AbCdEf1234/image/abc"));
        assert!(!hub_path("/api/rooms/AbCdEf1234/journal/../../x"));
        assert!(!hub_path("/api/rooms/ab/journal/x"));
        assert!(!hub_path("http://elsewhere/api/rooms/AbCdEf1234/journal/x"));
    }
}
