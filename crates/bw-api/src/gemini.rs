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
                404 => format!("Gemini doesn't know the model {model:?}: pick another in Settings → Gemini."),
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

/// `geminiGenerate`, run without holding the core's lock while Gemini thinks.
pub fn dispatch_unlocked(core: &Arc<Mutex<Core>>, command: &str, args: &Value) -> Option<Result<Value, String>> {
    if command != "geminiGenerate" {
        return None;
    }
    Some((|| {
        let (key, model) = core
            .lock()
            .map_err(|e| e.to_string())?
            .gemini()
            .map_err(|e| e.to_string())?
            .ok_or("Add your Gemini API key first (Settings → Gemini).")?;
        generate(&key, &model, args).map(Value::String)
    })())
}

#[cfg(test)]
mod tests {
    use super::valid_model;

    #[test]
    fn model_names() {
        assert!(valid_model("gemini-2.5-flash"));
        assert!(valid_model("gemini-1.5-pro-002"));
        assert!(!valid_model("gemini/../x"));
        assert!(!valid_model("a?key=1"));
        assert!(!valid_model(""));
    }
}
