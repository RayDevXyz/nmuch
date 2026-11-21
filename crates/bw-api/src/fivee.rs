//! Fetching 5e content from the user's own 5etools site (see `bw_core::dnd`).
//!
//! 5etools keeps its content in JSON files under `data/` (`data/spells/index.json`,
//! `data/bestiary/bestiary-mm.json`, `data/races.json`, …). The frontend asks for one of those
//! files; the host fetches it from the address the user set and keeps it in memory for a while.
//! Fetching here, not in the webview, avoids the browser's cross-origin rules (a plain 5etools
//! server sends no CORS headers), and it happens outside the core's lock, so loading a large
//! bestiary doesn't hold up the rest of the app.
//!
//! Only `data/…json` paths are fetched, and only from the configured address.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use bw_core::Core;
use serde::Deserialize;
use serde_json::Value;

const TTL: Duration = Duration::from_secs(15 * 60);
const MAX_BYTES: u64 = 64 * 1024 * 1024;

type Cache = Mutex<HashMap<String, (Instant, Arc<Value>)>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `data/…/name.json`: no `..`, no query, nothing outside `data/`.
pub fn valid_path(path: &str) -> bool {
    path.starts_with("data/")
        && path.ends_with(".json")
        && path.len() < 200
        && !path.contains("..")
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
}

#[derive(Deserialize)]
struct Args {
    path: String,
    #[serde(default)]
    fresh: bool,
}

/// Fetch `base` + `path` (cached unless `fresh`).
pub fn fetch(base: &str, path: &str, fresh: bool) -> Result<Arc<Value>, String> {
    if !valid_path(path) {
        return Err(format!("not a 5etools data file: {path}"));
    }
    let url = format!("{base}{path}");
    if !fresh {
        if let Some((at, v)) = cache().lock().map_err(|e| e.to_string())?.get(&url) {
            if at.elapsed() < TTL {
                return Ok(v.clone());
            }
        }
    }
    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => format!("{path} isn't on your 5etools site"),
            ureq::Error::Status(code, _) => format!("5etools answered {code} for {path}"),
            other => format!("can't reach 5etools at {base}: {other}"),
        })?;
    let value: Value = serde_json::from_reader(std::io::Read::take(resp.into_reader(), MAX_BYTES))
        .map_err(|e| format!("{path} is not valid JSON: {e}"))?;
    let value = Arc::new(value);
    cache()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(url, (Instant::now(), value.clone()));
    Ok(value)
}

/// Commands the host runs without holding the core's lock for long (both hosts call this
/// before locking). `None`: not one of these; dispatch it as usual.
pub fn dispatch_unlocked(
    core: &Arc<Mutex<Core>>,
    command: &str,
    args: &Value,
) -> Option<Result<Value, String>> {
    if command != "fiveeFetch" {
        return None;
    }
    Some((|| {
        let a = Args::deserialize(args).map_err(|e| format!("bad arguments: {e}"))?;
        // Read the address under the lock, then let go before fetching.
        let base = core
            .lock()
            .map_err(|e| e.to_string())?
            .dnd_source()
            .map_err(|e| e.to_string())?
            .ok_or("Set the address of your 5etools site first (Compendium → Settings).")?;
        fetch(&base, &a.path, a.fresh).map(|v| (*v).clone())
    })())
}

#[cfg(test)]
mod tests {
    use super::valid_path;

    #[test]
    fn only_data_files() {
        assert!(valid_path("data/spells/index.json"));
        assert!(valid_path("data/bestiary/bestiary-mm.json"));
        assert!(!valid_path("data/../secret.json"));
        assert!(!valid_path("index.html"));
        assert!(!valid_path("data/spells/index.json?x=1"));
        assert!(!valid_path("data/x.json/../../y.json"));
        assert!(!valid_path("/etc/passwd"));
    }
}
