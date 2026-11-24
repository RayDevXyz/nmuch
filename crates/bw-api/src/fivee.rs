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
//!
//! Pictures (`fiveeImage`) come from 5etools' `img/` folder: under the site, or at a separate
//! address the user set. They're returned as data URLs, so the webview needs no access to the
//! 5etools host (a hosted BrainWaves on https can't load pictures from a plain http address).

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

const MAX_IMAGE: u64 = 24 * 1024 * 1024;
const KEEP_IMAGES: usize = 300;

type ImageCache = Mutex<(HashMap<String, Arc<String>>, Vec<String>)>;
fn image_cache() -> &'static ImageCache {
    static C: OnceLock<ImageCache> = OnceLock::new();
    C.get_or_init(|| Mutex::new((HashMap::new(), Vec::new())))
}

/// A picture's path inside `img/`: `bestiary/tokens/MM/Goblin.webp`. Names have spaces,
/// apostrophes, commas and brackets; nothing that leaves the folder or adds a query.
pub fn valid_image_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    !path.is_empty()
        && path.len() < 400
        && !path.starts_with('/')
        && !path.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..")
        && !path.chars().any(|c| c.is_control() || matches!(c, '?' | '#' | '\\' | '%'))
        && [".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg"].iter().any(|ext| lower.ends_with(ext))
}

fn mime_of(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    match lower.rsplit('.').next() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "image/webp",
    }
}

/// Percent-encode each part of a path (spaces, apostrophes…), keeping the slashes.
fn encode_path(path: &str) -> String {
    path.split('/')
        .map(|seg| {
            seg.bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                        (b as char).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Fetch a picture from `base` (the `img/` folder) as a data URL (kept for a while).
pub fn fetch_image(base: &str, path: &str) -> Result<Arc<String>, String> {
    use base64::Engine;
    if !valid_image_path(path) {
        return Err(format!("not a 5etools picture: {path}"));
    }
    let url = format!("{base}{}", encode_path(path));
    if let Some(v) = image_cache().lock().map_err(|e| e.to_string())?.0.get(&url) {
        return Ok(v.clone());
    }
    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(60))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => format!("{path} isn't among your 5etools pictures"),
            ureq::Error::Status(code, _) => format!("5etools answered {code} for {path}"),
            other => format!("can't reach your 5etools pictures at {base}: {other}"),
        })?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(resp.into_reader(), MAX_IMAGE + 1), &mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE {
        return Err(format!("{path} is larger than {} MB", MAX_IMAGE >> 20));
    }
    let data = Arc::new(format!("data:{};base64,{}", mime_of(path), base64::engine::general_purpose::STANDARD.encode(&bytes)));
    let mut c = image_cache().lock().map_err(|e| e.to_string())?;
    let (map, order) = &mut *c;
    map.insert(url.clone(), data.clone());
    order.push(url);
    while order.len() > KEEP_IMAGES {
        let old = order.remove(0);
        map.remove(&old);
    }
    Ok(data)
}

#[derive(Deserialize)]
struct ImageArgs {
    path: String,
}

/// Commands the host runs without holding the core's lock for long (both hosts call this
/// before locking). `None`: not one of these; dispatch it as usual.
pub fn dispatch_unlocked(
    core: &Arc<Mutex<Core>>,
    command: &str,
    args: &Value,
) -> Option<Result<Value, String>> {
    if command == "fiveeImage" {
        return Some((|| {
            let a = ImageArgs::deserialize(args).map_err(|e| format!("bad arguments: {e}"))?;
            let base = {
                let core = core.lock().map_err(|e| e.to_string())?;
                match core.dnd_image_source().map_err(|e| e.to_string())? {
                    Some(b) => b,
                    None => format!(
                        "{}img/",
                        core.dnd_source()
                            .map_err(|e| e.to_string())?
                            .ok_or("Set the address of your 5etools site first (Compendium → Settings).")?
                    ),
                }
            };
            fetch_image(&base, &a.path).map(|v| Value::String((*v).clone()))
        })());
    }
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
    use super::{encode_path, valid_image_path, valid_path};

    #[test]
    fn only_pictures() {
        assert!(valid_image_path("bestiary/tokens/MM/Goblin.webp"));
        assert!(valid_image_path("bestiary/tokens/MM/Adult Black Dragon.webp"));
        assert!(valid_image_path("adventure/LMoP/Cragmaw Hideout (Player).webp"));
        assert!(!valid_image_path("../data/secret.webp"));
        assert!(!valid_image_path("a/../../b.png"));
        assert!(!valid_image_path("/etc/x.png"));
        assert!(!valid_image_path("x.png?y=1"));
        assert!(!valid_image_path("x%2e%2e/y.png"));
        assert!(!valid_image_path("data/x.json"));
        assert_eq!(encode_path("tokens/MM/Xanathar's Pet.webp"), "tokens/MM/Xanathar%27s%20Pet.webp");
    }

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
