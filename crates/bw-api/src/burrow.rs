//! Talking to the user's Burrow (see `bw_core::burrow`). The web app asks; the host calls Burrow
//! with the token, so the token stays here and the browser's cross-origin rules don't apply.
//!
//! Only a few reads (bookmarks, one bookmark, a URL lookup, tags, collections) and creating a
//! bookmark are allowed, nothing that changes or deletes what's in Burrow.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bw_core::Core;
use serde::Deserialize;
use serde_json::{json, Map, Value};

const MAX_BYTES: u64 = 16 * 1024 * 1024;
const QUERY_KEYS: [&str; 9] = ["q", "tag", "collection", "favorite", "archived", "type", "sort", "limit", "offset"];

/// What may be read: `bookmarks`, `bookmarks/<id>`, `bookmarks/lookup`, `tags`, `collections`.
pub fn readable(path: &str) -> bool {
    match path.split('/').collect::<Vec<_>>().as_slice() {
        ["bookmarks"] | ["bookmarks", "lookup"] | ["tags"] | ["collections"] => true,
        ["bookmarks", id] => !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric()),
        _ => false,
    }
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn connection(core: &Arc<Mutex<Core>>) -> Result<bw_core::burrow::Connection, String> {
    core.lock()
        .map_err(|e| e.to_string())?
        .burrow_connection()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Connect Burrow first (the Burrow panel → Connect).".to_string())
}

fn explain(url: &str, e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401 | 403, _) => "Burrow refused the token: make a new one in Burrow (Settings → New token).".into(),
        ureq::Error::Status(404, _) => "Burrow doesn't have that.".into(),
        ureq::Error::Status(code, r) => {
            let body = r.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["error"].as_str().map(String::from)).unwrap_or_default();
            format!("Burrow answered {code}{}", if msg.is_empty() { String::new() } else { format!(": {msg}") })
        }
        other => format!("can't reach Burrow at {url}: {other}"),
    }
}

fn read_json(url: &str, resp: ureq::Response) -> Result<Value, String> {
    let html = resp.content_type().contains("html");
    let v: Result<Value, _> = serde_json::from_reader(std::io::Read::take(resp.into_reader(), MAX_BYTES));
    match v {
        Ok(v) => Ok(v),
        // A reverse proxy's own sign-in page, not Burrow.
        Err(_) if html => Err(format!(
            "{url} answered with a web page, not Burrow's API. If a proxy (Cosmos) asks for its own login there, turn that off for Burrow; Burrow has its own."
        )),
        Err(e) => Err(format!("Burrow sent something unexpected: {e}")),
    }
}

/// GET `path` (one of [`readable`]) with the allowed query parameters.
pub fn get(core: &Arc<Mutex<Core>>, path: &str, query: &Map<String, Value>) -> Result<Value, String> {
    if !readable(path) {
        return Err(format!("not something BrainWaves reads from Burrow: {path}"));
    }
    let c = connection(core)?;
    let mut url = format!("{}/api/{path}", c.url);
    let params: Vec<String> = query
        .iter()
        .filter(|(k, _)| QUERY_KEYS.contains(&k.as_str()) || (path == "bookmarks/lookup" && k.as_str() == "url"))
        .filter_map(|(k, v)| {
            let s = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => (if *b { "1" } else { "0" }).to_string(),
                _ => return None,
            };
            (s.len() <= 2048).then(|| format!("{k}={}", encode(&s)))
        })
        .collect();
    if !params.is_empty() {
        url.push('?');
        url.push_str(&params.join("&"));
    }
    let resp = ureq::get(&url).set("authorization", &format!("Bearer {}", c.token)).timeout(Duration::from_secs(20)).call().map_err(|e| explain(&c.url, e))?;
    read_json(&c.url, resp)
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Save {
    url: Option<String>,
    note: Option<String>,
    title: Option<String>,
    tags: Vec<String>,
    collection_id: Option<i64>,
}

/// Save a link or a note to Burrow (Burrow keeps one bookmark per URL and says if it existed).
pub fn save(core: &Arc<Mutex<Core>>, args: &Value) -> Result<Value, String> {
    let s = Save::deserialize(args).map_err(|e| format!("bad arguments: {e}"))?;
    if let Some(u) = &s.url {
        if !(u.starts_with("http://") || u.starts_with("https://")) || u.len() > 4096 {
            return Err(format!("only web links can be saved to Burrow: {u}"));
        }
    } else if s.note.as_deref().unwrap_or("").trim().is_empty() && s.title.as_deref().unwrap_or("").trim().is_empty() {
        return Err("Nothing to save.".into());
    }
    let tags: Vec<String> = s.tags.iter().map(|t| t.trim().trim_start_matches('#').to_string()).filter(|t| !t.is_empty() && t.len() <= 80).take(30).collect();
    let mut body = json!({ "tags": tags });
    if let Some(u) = s.url {
        body["url"] = json!(u);
    }
    if let Some(n) = s.note {
        body["note"] = json!(n.chars().take(200_000).collect::<String>());
    }
    if let Some(t) = s.title {
        body["title"] = json!(t.chars().take(300).collect::<String>());
    }
    if let Some(c) = s.collection_id {
        body["collectionId"] = json!(c);
    }
    let c = connection(core)?;
    let resp = ureq::post(&format!("{}/api/bookmarks", c.url))
        .set("authorization", &format!("Bearer {}", c.token))
        .set("content-type", "application/json")
        .timeout(Duration::from_secs(20))
        .send_string(&body.to_string())
        .map_err(|e| explain(&c.url, e))?;
    read_json(&c.url, resp)
}

#[derive(Deserialize)]
struct GetArgs {
    path: String,
    #[serde(default)]
    query: Map<String, Value>,
}

/// The Burrow commands that go over the network (run without holding the core).
pub fn dispatch_unlocked(core: &Arc<Mutex<Core>>, command: &str, args: &Value) -> Option<Result<Value, String>> {
    match command {
        "burrowGet" => Some(GetArgs::deserialize(args).map_err(|e| format!("bad arguments: {e}")).and_then(|a| get(core, &a.path, &a.query))),
        "burrowSave" => Some(save(core, args)),
        "burrowTest" => Some(get(core, "tags", &Map::new()).map(|tags| json!({ "ok": true, "tags": tags.as_array().map(|a| a.len()).unwrap_or(0) }))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_some_paths() {
        for ok in ["bookmarks", "bookmarks/12", "bookmarks/lookup", "tags", "collections"] {
            assert!(readable(ok), "{ok}");
        }
        for no in ["bookmarks/12/archive", "tokens", "export", "bookmarks/../tokens", "bookmarks/1?x", "", "spaces"] {
            assert!(!readable(no), "{no}");
        }
        assert_eq!(encode("a b&c#d/é"), "a%20b%26c%23d%2F%C3%A9");
    }
}
