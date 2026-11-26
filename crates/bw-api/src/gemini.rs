//! Google Gemini, for world building in the D&D module.
//!
//! The owner's Gemini API key (from Google AI Studio) is kept by the core and never sent back to
//! the app: the app asks for text through `geminiGenerate`, and this side adds the key and calls
//! the Gemini API. The call runs outside the core's lock (an answer can take a minute).
//!
//! `BW_GEMINI_URL` points it elsewhere (a proxy, or a stand-in for tests).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bw_core::Core;
use serde::Deserialize;
use serde_json::{json, Value};

pub const DEFAULT_MODEL: &str = "gemini-2.5-flash";
const GONE: &str = "Gemini doesn't know the model ";
const MAX_INPUT: usize = 400_000;

#[derive(Deserialize)]
struct Msg {
    /// `user` or `model`.
    role: String,
    text: String,
}

#[derive(Deserialize)]
struct Args {
    #[serde(default)]
    system: String,
    messages: Vec<Msg>,
    /// Ask for a JSON answer.
    #[serde(default)]
    json: bool,
    #[serde(default)]
    temperature: Option<f64>,
}

fn base() -> String {
    std::env::var("BW_GEMINI_URL").unwrap_or_else(|_| "https://generativelanguage.googleapis.com".into()).trim_end_matches('/').to_string()
}

/// A model name as the API takes it (`gemini-2.5-flash`), nothing that changes the URL's shape.
pub fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() < 80 && m.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

/// A model the key can use for text.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct Model {
    /// As the API takes it: `gemini-3.5-flash`.
    pub id: String,
    pub name: String,
    pub description: String,
}

/// The models this key may use to write text (Google adds and retires them; this is the truth).
pub fn models(key: &str) -> Result<Vec<Model>, String> {
    let url = format!("{}/v1beta/models?pageSize=1000", base());
    let resp = ureq::get(&url).set("x-goog-api-key", key).timeout(Duration::from_secs(30)).call().map_err(|e| match e {
        ureq::Error::Status(400 | 401 | 403, _) => "Gemini refused the API key: check it in Settings → Gemini.".to_string(),
        ureq::Error::Status(code, _) => format!("Gemini answered {code} when asked for its models"),
        other => format!("Can't reach Gemini: {other}"),
    })?;
    let v: Value = serde_json::from_reader(resp.into_reader()).map_err(|e| format!("Gemini's model list could not be read: {e}"))?;
    let mut out = vec![];
    for m in v["models"].as_array().cloned().unwrap_or_default() {
        let id = m["name"].as_str().unwrap_or("").trim_start_matches("models/").to_string();
        let writes = m["supportedGenerationMethods"].as_array().is_some_and(|a| a.iter().any(|x| x == "generateContent"));
        let lower = id.to_ascii_lowercase();
        // Text models only: not embeddings, speech, pictures, live audio or robots.
        let other = ["embedding", "tts", "image", "audio", "live", "aqa", "robotics", "computer-use", "veo", "imagen", "learnlm"].iter().any(|w| lower.contains(w));
        if writes && !other && lower.starts_with("gemini") && valid_model(&id) {
            out.push(Model { name: m["displayName"].as_str().unwrap_or(&id).to_string(), description: m["description"].as_str().unwrap_or("").to_string(), id });
        }
    }
    // Newest first; previews after the stable ones of the same version.
    out.sort_by(|a, b| version(&b.id).total_cmp(&version(&a.id)).then(a.id.contains("preview").cmp(&b.id.contains("preview"))).then(a.id.cmp(&b.id)));
    Ok(out)
}

/// The version in a model's name (`gemini-3.5-flash` → 3.5).
fn version(id: &str) -> f64 {
    id.split('-').find_map(|p| p.parse::<f64>().ok()).unwrap_or(0.0)
}

/// The model to use when none was chosen (or the chosen one is gone): the newest stable Flash,
/// else the newest stable model, else anything.
pub fn best(list: &[Model]) -> Option<String> {
    // Previews and experiments come and go; a dated or "-latest" alias may too.
    let stable = |m: &&Model| !["preview", "exp", "latest"].iter().any(|w| m.id.contains(w));
    let pick = |f: &dyn Fn(&&Model) -> bool| list.iter().filter(stable).filter(f).max_by(|a, b| version(&a.id).total_cmp(&version(&b.id))).map(|m| m.id.clone());
    pick(&|m| m.id.contains("flash") && !m.id.contains("lite"))
        .or_else(|| pick(&|m| !m.id.contains("lite")))
        .or_else(|| pick(&|_| true))
        .or_else(|| list.iter().filter(|m| m.id.contains("flash")).max_by(|a, b| version(&a.id).total_cmp(&version(&b.id))).map(|m| m.id.clone()))
        .or_else(|| list.first().map(|m| m.id.clone()))
}

/// Ask Gemini. Returns the answer's text.
pub fn generate(key: &str, model: &str, args: &Value) -> Result<String, String> {
    let a = Args::deserialize(args).map_err(|e| format!("bad arguments: {e}"))?;
    if !valid_model(model) {
        return Err(format!("{model:?} is not a Gemini model name"));
    }
    let size: usize = a.system.len() + a.messages.iter().map(|m| m.text.len()).sum::<usize>();
    if size > MAX_INPUT {
        return Err("That's too much to send at once: leave some of the campaign out.".into());
    }
    let contents: Vec<Value> = a
        .messages
        .iter()
        .filter(|m| !m.text.trim().is_empty())
        .map(|m| json!({ "role": if m.role == "model" { "model" } else { "user" }, "parts": [{ "text": m.text }] }))
        .collect();
    if contents.is_empty() {
        return Err("Nothing to ask.".into());
    }
    let mut config = json!({ "temperature": a.temperature.unwrap_or(0.9).clamp(0.0, 2.0) });
    if a.json {
        config["responseMimeType"] = json!("application/json");
    }
    let mut body = json!({ "contents": contents, "generationConfig": config });
    if !a.system.trim().is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": a.system }] });
    }
    let url = format!("{}/v1beta/models/{model}:generateContent", base());
    let resp = ureq::post(&url)
        .set("x-goog-api-key", key)
        .set("content-type", "application/json")
        .timeout(Duration::from_secs(180))
        .send_string(&body.to_string());
    let value: Value = match resp {
        Ok(r) => serde_json::from_reader(r.into_reader()).map_err(|e| format!("Gemini's answer could not be read: {e}"))?,
        Err(ureq::Error::Status(code, r)) => {
            let detail: Value = serde_json::from_reader(r.into_reader()).unwrap_or(Value::Null);
            let msg = detail["error"]["message"].as_str().unwrap_or("").to_string();
            return Err(match code {
                400 if msg.contains("API key") => "Gemini refused the API key: check it in Settings → Gemini.".into(),
                401 | 403 => "Gemini refused the API key: check it in Settings → Gemini.".into(),
                404 => format!("{GONE}{model:?}: pick another in Settings → Gemini."),
                429 => "Gemini says: too many requests for now (your plan's limit). Wait a minute and try again.".into(),
                _ => format!("Gemini answered {code}{}", if msg.is_empty() { String::new() } else { format!(": {msg}") }),
            });
        }
        Err(e) => return Err(format!("Can't reach Gemini: {e}")),
    };
    if let Some(reason) = value["promptFeedback"]["blockReason"].as_str() {
        return Err(format!("Gemini wouldn't answer that ({reason})."));
    }
    let parts = value["candidates"][0]["content"]["parts"].as_array().cloned().unwrap_or_default();
    let text: String = parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("");
    if text.trim().is_empty() {
        let why = value["candidates"][0]["finishReason"].as_str().unwrap_or("no text");
        return Err(format!("Gemini gave no answer ({why})."));
    }
    Ok(text)
}

/// `geminiGenerate` and `geminiModels`, run without holding the core's lock while Gemini works.
///
/// When the chosen model is gone (Google retires models), the newest one the key can use is
/// picked, kept as the new choice, and the question asked again.
pub fn dispatch_unlocked(core: &Arc<Mutex<Core>>, command: &str, args: &Value) -> Option<Result<Value, String>> {
    if command != "geminiGenerate" && command != "geminiModels" {
        return None;
    }
    Some((|| {
        let (key, model) = core
            .lock()
            .map_err(|e| e.to_string())?
            .gemini()
            .map_err(|e| e.to_string())?
            .ok_or("Add your Gemini API key first (Settings → Gemini).")?;
        if command == "geminiModels" {
            let list = models(&key)?;
            return Ok(json!({ "models": list, "best": best(&list), "current": model }));
        }
        match generate(&key, &model, args) {
            Err(e) if e.starts_with(GONE) => {
                let list = models(&key)?;
                let next = best(&list).filter(|m| *m != model).ok_or(e)?;
                core.lock().map_err(|e| e.to_string())?.set_gemini(None, Some(&next)).map_err(|e| e.to_string())?;
                generate(&key, &next, args).map(Value::String)
            }
            other => other.map(Value::String),
        }
    })())
}

#[cfg(test)]
mod tests {
    use super::{best, valid_model, Model};

    fn m(id: &str) -> Model {
        Model { id: id.into(), name: id.into(), description: String::new() }
    }

    #[test]
    fn picks_the_newest_stable_flash() {
        let list = [m("gemini-2.5-flash-lite"), m("gemini-3.5-flash"), m("gemini-3.8-flash-preview-11-2026"), m("gemini-3.5-pro"), m("gemini-3.1-flash-lite-preview")];
        assert_eq!(best(&list).as_deref(), Some("gemini-3.5-flash"));
        assert_eq!(best(&[m("gemini-3.5-pro"), m("gemini-3.5-flash-lite")]).as_deref(), Some("gemini-3.5-pro"));
        assert_eq!(best(&[m("gemini-4.0-flash-preview-01-2027")]).as_deref(), Some("gemini-4.0-flash-preview-01-2027"));
        assert_eq!(best(&[]), None);
    }

    #[test]
    fn model_names() {
        assert!(valid_model("gemini-2.5-flash"));
        assert!(valid_model("gemini-1.5-pro-002"));
        assert!(!valid_model("gemini/../x"));
        assert!(!valid_model("a?key=1"));
        assert!(!valid_model(""));
    }
}
