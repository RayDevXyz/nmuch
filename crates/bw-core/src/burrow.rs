//! The connection to the user's Burrow (a self-hosted bookmark manager and web archive,
//! <https://github.com/RayDevXyz/burrow>): its address and an API token made in Burrow.
//!
//! Kept as a grant of the built-in `brainwaves.burrow` module, in this workspace only. The
//! token never goes to the web app: hosts call Burrow themselves (`bw_api::burrow`).

use rusqlite::OptionalExtension;
use serde_json::{json, Value};

use crate::core::Core;
use crate::error::{Error, Result};
use crate::modules::ModuleManifest;

pub const MODULE_ID: &str = "brainwaves.burrow";

pub fn manifest() -> ModuleManifest {
    ModuleManifest {
        id: MODULE_ID.into(),
        name: "Burrow".into(),
        description: "Your Burrow bookmarks in BrainWaves: cards in pages, a side panel, saving links and pages, shared tags.".into(),
        version: "1".into(),
        icon: "🦫".into(),
        namespace: "burrow".into(),
        capabilities: vec![],
    }
}

/// Where Burrow runs and the token to use.
#[derive(Debug, Clone, PartialEq)]
pub struct Connection {
    pub url: String,
    pub token: String,
}

impl Core {
    pub fn register_burrow_module(&mut self) -> Result<()> {
        self.install_module(&manifest(), "", true)
    }

    /// Set (or, with an empty address, forget) the connection.
    pub fn burrow_set_connection(&mut self, url: &str, token: &str) -> Result<()> {
        self.conn().execute("DELETE FROM module_grants WHERE module_id = ?1 AND kind = 'source'", [MODULE_ID])?;
        let url = url.trim().trim_end_matches('/');
        if url.is_empty() {
            return Ok(());
        }
        if !(url.starts_with("http://") || url.starts_with("https://")) || url.contains(char::is_whitespace) || url.len() > 300 {
            return Err(Error::Invalid(format!("{url:?} is not an http(s) address")));
        }
        let token = token.trim();
        if token.len() < 8 || token.len() > 300 || token.contains(char::is_whitespace) {
            return Err(Error::Invalid("paste the API token from Burrow (Settings → New token)".into()));
        }
        self.conn().execute(
            "INSERT INTO module_grants(module_id, kind, value, granted_at) VALUES (?1, 'source', ?2, ?3)",
            rusqlite::params![MODULE_ID, json!({ "url": url, "token": token }).to_string(), crate::store::now_millis()],
        )?;
        Ok(())
    }

    pub fn burrow_connection(&self) -> Result<Option<Connection>> {
        let v: Option<String> = self
            .conn()
            .query_row("SELECT value FROM module_grants WHERE module_id = ?1 AND kind = 'source'", [MODULE_ID], |r| r.get(0))
            .optional()?;
        Ok(v.and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|v| {
            Some(Connection { url: v["url"].as_str()?.to_string(), token: v["token"].as_str()?.to_string() })
        }))
    }
}
