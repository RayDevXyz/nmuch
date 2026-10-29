//! Modules: logic that works on your pages and files through capabilities you approve.
//!
//! **The model.** A module has a manifest naming the **capabilities** it needs, as plain
//! strings the user reads and approves once:
//!
//! | capability        | allows                                                               |
//! |-------------------|----------------------------------------------------------------------|
//! | `db.own`          | create databases; read and write the databases it created            |
//! | `db.read`         | read any database                                                    |
//! | `db.write`        | change rows of any database                                          |
//! | `fs.pick`         | ask the user to pick folders; each picked folder becomes readable    |
//! | `fs.read:<path>`  | read files under a fixed path (`~` is the home folder)               |
//! | `fs.open`         | open readable files in their default app                             |
//!
//! Every module may also read and write **props in its own namespace** (`course.*` for the
//! Course module) on any page, which is how "a course is just a page with extra properties"
//! stays true.
//!
//! **The rule.** Modules never touch the disk or the database directly. They call the
//! primitives here, which check the caller's approved capabilities and granted folders every
//! time. First-party modules (the Course module, `course.rs`) are Rust compiled into the app and
//! go through the same checks; third-party modules are sandboxed JavaScript whose calls the host
//! forwards with the module's id attached.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::Core;
use crate::database::View;
use crate::db_query::DatabaseResult;
use crate::error::{Error, Result};
use crate::schema::{PageId, PageMeta};
use crate::store::now_millis;

/// Page prop naming the module that created a database (`db.own`).
pub const OWNER_PROP: &str = "module.owner";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub icon: String,
    /// Prefix of the props this module owns, e.g. `course` for `course.progress`.
    pub namespace: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Capability {
    DbOwn,
    DbRead,
    DbWrite,
    FsPick,
    FsOpen,
    FsRead(String),
}

impl Capability {
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "db.own" => Self::DbOwn,
            "db.read" => Self::DbRead,
            "db.write" => Self::DbWrite,
            "fs.pick" => Self::FsPick,
            "fs.open" => Self::FsOpen,
            _ => match s.strip_prefix("fs.read:") {
                Some(p) if !p.trim().is_empty() => Self::FsRead(p.trim().to_string()),
                _ => return Err(Error::Invalid(format!("unknown capability {s:?}"))),
            },
        })
    }

    /// What the approval dialog says.
    pub fn describe(&self) -> String {
        match self {
            Self::DbOwn => "Create its own databases and change them".into(),
            Self::DbRead => "Read all your databases".into(),
            Self::DbWrite => "Change rows in any of your databases".into(),
            Self::FsPick => "Ask you to choose folders it may read".into(),
            Self::FsOpen => "Open files it can read in their default app".into(),
            Self::FsRead(p) => format!("Read files in {p}"),
        }
    }
}

/// A module as listed: its manifest and where it stands.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleInfo {
    pub manifest: ModuleManifest,
    pub builtin: bool,
    pub installed_at: i64,
    /// Every capability in the manifest is approved.
    pub approved: bool,
    /// Capabilities in the manifest that aren't approved yet, described for people.
    pub pending: Vec<String>,
    /// Folders the user picked for it.
    pub folders: Vec<String>,
    /// The module's code (third-party only). Omitted in listings.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub code: String,
}

/// One entry of a folder listing.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub path: String,
    /// Path relative to the folder that was listed, with `/` separators.
    pub rel: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Milliseconds since the epoch.
    pub modified: i64,
}

fn validate_manifest(m: &ModuleManifest) -> Result<Vec<Capability>> {
    let bad = |why: String| Err(Error::Invalid(format!("module manifest: {why}")));
    let ok_id = m.id.len() >= 2
        && m.id.len() <= 64
        && m.id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
    if !ok_id {
        return bad(format!(
            "id {:?} must be 2-64 characters of a-z, 0-9, '.', '-', '_'",
            m.id
        ));
    }
    if m.name.trim().is_empty() {
        return bad("name is required".into());
    }
    let ok_ns = !m.namespace.is_empty()
        && m.namespace.len() <= 32
        && m.namespace
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !["db", "module", "page"].contains(&m.namespace.as_str());
    if !ok_ns {
        return bad(format!(
            "namespace {:?} must be a short lowercase word (not db, module or page)",
            m.namespace
        ));
    }
    m.capabilities
        .iter()
        .map(|c| Capability::parse(c))
        .collect()
}

/// `~` and `~/…` become the home folder.
pub fn expand_home(p: &str) -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    match (p.strip_prefix('~'), home) {
        (Some(rest), Some(h))
            if rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\') =>
        {
            PathBuf::from(h).join(rest.trim_start_matches(['/', '\\']))
        }
        _ => PathBuf::from(p),
    }
}

/// The real, absolute path, with `..` and links resolved, so `starts_with` checks can't be
/// fooled. Paths that don't exist are refused.
fn real(p: &Path) -> Result<PathBuf> {
    if p.components().any(|c| matches!(c, Component::ParentDir)) && !p.is_absolute() {
        return Err(Error::Forbidden(format!(
            "{} is not an absolute path",
            p.display()
        )));
    }
    std::fs::canonicalize(p).map_err(|e| Error::Invalid(format!("{}: {e}", p.display())))
}

fn millis(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Core {
    // ---------------------------------------------------------------- registry

    pub fn install_module(
        &mut self,
        manifest: &ModuleManifest,
        code: &str,
        builtin: bool,
    ) -> Result<()> {
        validate_manifest(manifest)?;
        if code.len() > 2 * 1024 * 1024 {
            return Err(Error::Invalid("module code is larger than 2 MB".into()));
        }
        let existing: Option<bool> = self
            .conn()
            .query_row(
                "SELECT builtin FROM modules WHERE id = ?1",
                [&manifest.id],
                |r| r.get(0),
            )
            .optional()?;
        if existing == Some(true) && !builtin {
            return Err(Error::Invalid(format!(
                "{} is a built-in module",
                manifest.id
            )));
        }
        let json = serde_json::to_string(manifest).map_err(|e| Error::Invalid(e.to_string()))?;
        self.conn().execute(
            "INSERT INTO modules(id, manifest, code, builtin, installed_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET manifest = excluded.manifest, code = excluded.code,
                 builtin = excluded.builtin",
            params![manifest.id, json, code, builtin, now_millis()],
        )?;
        // Built-in modules ship with the app: what they need is approved with it.
        if builtin {
            self.approve_module(&manifest.id)?;
        }
        self.watch_generation += 1;
        Ok(())
    }

    /// Uninstall: the module, its approvals and its folders go. Pages and databases it made stay.
    pub fn remove_module(&mut self, id: &str) -> Result<()> {
        if self.module_info(id)?.builtin {
            return Err(Error::Invalid(format!("{id} is a built-in module")));
        }
        self.conn()
            .execute("DELETE FROM module_grants WHERE module_id = ?1", [id])?;
        self.conn()
            .execute("DELETE FROM modules WHERE id = ?1", [id])?;
        self.watch_generation += 1;
        Ok(())
    }

    pub fn list_modules(&self) -> Result<Vec<ModuleInfo>> {
        let ids: Vec<String> = self
            .conn()
            .prepare("SELECT id FROM modules ORDER BY builtin DESC, id")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        ids.iter()
            .map(|id| {
                let mut m = self.module_info(id)?;
                m.code.clear();
                Ok(m)
            })
            .collect()
    }

    pub fn module_info(&self, id: &str) -> Result<ModuleInfo> {
        let (manifest, code, builtin, installed_at): (String, String, bool, i64) = self
            .conn()
            .query_row(
                "SELECT manifest, code, builtin, installed_at FROM modules WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| Error::Invalid(format!("no module {id}")))?;
        let manifest: ModuleManifest =
            serde_json::from_str(&manifest).map_err(|e| Error::Malformed(e.to_string()))?;
        let granted = self.grants(id, "capability")?;
        let pending: Vec<String> = manifest
            .capabilities
            .iter()
            .filter(|c| !granted.contains(*c))
            .filter_map(|c| Capability::parse(c).ok().map(|c| c.describe()))
            .collect();
        Ok(ModuleInfo {
            approved: pending.is_empty(),
            pending,
            folders: self.grants(id, "folder")?.into_iter().collect(),
            manifest,
            builtin,
            installed_at,
            code,
        })
    }

    fn grants(&self, module: &str, kind: &str) -> Result<BTreeSet<String>> {
        Ok(self
            .conn()
            .prepare("SELECT value FROM module_grants WHERE module_id = ?1 AND kind = ?2")?
            .query_map(params![module, kind], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    }

    /// The user approved everything the module's manifest asks for.
    pub fn approve_module(&mut self, id: &str) -> Result<()> {
        let info = self.module_info(id)?;
        for c in &info.manifest.capabilities {
            self.conn().execute(
                "INSERT OR IGNORE INTO module_grants(module_id, kind, value, granted_at) VALUES (?1, 'capability', ?2, ?3)",
                params![id, c, now_millis()],
            )?;
        }
        self.watch_generation += 1;
        Ok(())
    }

    /// Withdraw every approval and folder. The module stays installed but can't do anything.
    pub fn revoke_module(&mut self, id: &str) -> Result<()> {
        self.module_info(id)?;
        self.conn()
            .execute("DELETE FROM module_grants WHERE module_id = ?1", [id])?;
        self.watch_generation += 1;
        Ok(())
    }

    /// The user picked `folder` for this module in a folder dialog (needs `fs.pick`).
    /// Returns the folder's real path.
    pub fn grant_folder(&mut self, module: &str, folder: &str) -> Result<String> {
        self.require(module, &Capability::FsPick)?;
        let path = real(&expand_home(folder))?;
        if !path.is_dir() {
            return Err(Error::Invalid(format!(
                "{} is not a folder",
                path.display()
            )));
        }
        let s = path.to_string_lossy().to_string();
        self.conn().execute(
            "INSERT OR IGNORE INTO module_grants(module_id, kind, value, granted_at) VALUES (?1, 'folder', ?2, ?3)",
            params![module, s, now_millis()],
        )?;
        self.watch_generation += 1;
        Ok(s)
    }

    pub fn revoke_folder(&mut self, module: &str, folder: &str) -> Result<()> {
        self.conn().execute(
            "DELETE FROM module_grants WHERE module_id = ?1 AND kind = 'folder' AND value = ?2",
            params![module, folder],
        )?;
        self.watch_generation += 1;
        Ok(())
    }

    // ---------------------------------------------------------------- checks

    fn approved_caps(&self, module: &str) -> Result<Vec<Capability>> {
        let info = self.module_info(module)?;
        if !info.approved {
            return Err(Error::Forbidden(format!(
                "{} hasn't been approved yet",
                info.manifest.name
            )));
        }
        info.manifest
            .capabilities
            .iter()
            .map(|c| Capability::parse(c))
            .collect()
    }

    fn require(&self, module: &str, cap: &Capability) -> Result<()> {
        if self.approved_caps(module)?.contains(cap) {
            Ok(())
        } else {
            Err(Error::Forbidden(format!(
                "{module} may not: {}",
                cap.describe().to_lowercase()
            )))
        }
    }

    /// Folders this module may read: the ones the user picked plus fixed `fs.read:` paths.
    pub fn readable_roots(&self, module: &str) -> Result<Vec<PathBuf>> {
        let mut roots: Vec<PathBuf> = self
            .grants(module, "folder")?
            .into_iter()
            .map(PathBuf::from)
            .collect();
        for c in self.approved_caps(module)? {
            if let Capability::FsRead(p) = c {
                if let Ok(r) = real(&expand_home(&p)) {
                    roots.push(r);
                }
            }
        }
        Ok(roots)
    }

    /// The real path of `path` if the module may read it.
    pub fn check_read(&self, module: &str, path: &str) -> Result<PathBuf> {
        let p = real(&expand_home(path))?;
        if self
            .readable_roots(module)?
            .iter()
            .any(|r| p.starts_with(r))
        {
            Ok(p)
        } else {
            Err(Error::Forbidden(format!(
                "{module} may not read {}",
                p.display()
            )))
        }
    }

    /// Every folder some approved module may read: what the host watches for changes.
    /// `watch_generation` changes whenever this list may have.
    pub fn watch_roots(&self) -> Result<Vec<(String, PathBuf)>> {
        let mut out = vec![];
        for m in self.list_modules()? {
            if !m.approved {
                continue;
            }
            for r in self.readable_roots(&m.manifest.id)? {
                out.push((m.manifest.id.clone(), r));
            }
        }
        Ok(out)
    }

    pub fn watch_generation(&self) -> u64 {
        self.watch_generation
    }

    // ---------------------------------------------------------------- fs primitives

    /// List a folder (recursively up to `max` entries). Hidden files are skipped.
    pub fn fs_list(
        &self,
        module: &str,
        path: &str,
        recursive: bool,
        max: usize,
    ) -> Result<Vec<FsEntry>> {
        let root = self.check_read(module, path)?;
        let mut out = vec![];
        let walk = walkdir::WalkDir::new(&root)
            .min_depth(1)
            .max_depth(if recursive { 32 } else { 1 })
            .sort_by_file_name()
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'));
        for e in walk.flatten() {
            if out.len() >= max {
                break;
            }
            let meta = match e.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let rel = e
                .path()
                .strip_prefix(&root)
                .unwrap_or(e.path())
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            out.push(FsEntry {
                path: e.path().to_string_lossy().to_string(),
                rel,
                name: e.file_name().to_string_lossy().to_string(),
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified: millis(meta.modified()),
            });
        }
        Ok(out)
    }

    /// Read a text file (up to `max` bytes).
    pub fn fs_read_text(&self, module: &str, path: &str, max: usize) -> Result<String> {
        use std::io::Read;
        let p = self.check_read(module, path)?;
        let mut buf = vec![];
        std::fs::File::open(&p)
            .and_then(|f| f.take(max as u64).read_to_end(&mut buf))
            .map_err(|e| Error::Invalid(format!("{}: {e}", p.display())))?;
        Ok(String::from_utf8_lossy(&buf).to_string())
    }

    /// Check that the module may open `path` in its default app; returns the path to open.
    /// (The host does the opening: that's a desktop concern, not the core's.)
    pub fn fs_open_check(&self, module: &str, path: &str) -> Result<PathBuf> {
        self.require(module, &Capability::FsOpen)?;
        let p = self.check_read(module, path)?;
        if !p.is_file() {
            return Err(Error::Invalid(format!("{} is not a file", p.display())));
        }
        Ok(p)
    }

    // ---------------------------------------------------------------- data primitives

    /// Create a database owned by the module (`db.own`).
    pub fn module_create_database(
        &mut self,
        module: &str,
        id: &str,
        meta: PageMeta,
    ) -> Result<PageId> {
        self.require(module, &Capability::DbOwn)?;
        let id = self.create_database(id, meta)?;
        self.transact(&id, |t| {
            t.set_prop(&id, OWNER_PROP, Value::String(module.to_string()))
        })?;
        Ok(id)
    }

    fn owner_of(&mut self, database_id: &str) -> Result<Option<String>> {
        let snap = self.snapshot(database_id)?;
        Ok(snap
            .root()
            .props
            .get(OWNER_PROP)
            .and_then(|v| v.as_str())
            .map(String::from))
    }

    fn require_db(&mut self, module: &str, database_id: &str, write: bool) -> Result<()> {
        let caps = self.approved_caps(module)?;
        let own = caps.contains(&Capability::DbOwn)
            && self.owner_of(database_id)?.as_deref() == Some(module);
        let any = caps.contains(if write {
            &Capability::DbWrite
        } else {
            &Capability::DbRead
        });
        if own || any {
            Ok(())
        } else {
            Err(Error::Forbidden(format!(
                "{module} may not {} database {database_id}",
                if write { "change" } else { "read" }
            )))
        }
    }

    /// Add or change a column of a database the module may change.
    pub fn module_set_property(
        &mut self,
        module: &str,
        database_id: &str,
        prop: crate::database::Property,
    ) -> Result<()> {
        self.require_db(module, database_id, true)?;
        self.set_property(database_id, prop)
    }

    /// Tell subscribers (the frontend, sandboxed modules) that files changed under `root`.
    pub fn notify_fs_changed(&mut self, module: &str, root: &Path) {
        self.bus.emit(crate::events::Event::FsChanged {
            module_id: module.to_string(),
            root: root.to_string_lossy().to_string(),
        });
    }

    pub fn module_query(
        &mut self,
        module: &str,
        database_id: &str,
        view: Option<View>,
    ) -> Result<DatabaseResult> {
        self.require_db(module, database_id, false)?;
        self.query_database(database_id, None, view)
    }

    pub fn module_create_row(
        &mut self,
        module: &str,
        database_id: &str,
        row_id: &str,
        title: &str,
        values: &BTreeMap<String, Value>,
    ) -> Result<PageId> {
        self.require_db(module, database_id, true)?;
        self.create_row(database_id, row_id, title, values)
    }

    pub fn module_set_value(
        &mut self,
        module: &str,
        row_id: &str,
        prop_id: &str,
        value: Value,
    ) -> Result<()> {
        let db = self
            .snapshot(row_id)?
            .meta
            .database_id
            .ok_or_else(|| Error::Invalid(format!("{row_id} is not a database row")))?;
        self.require_db(module, &db, true)?;
        self.set_value(row_id, prop_id, value)
    }

    /// Set props in the module's own namespace on a page (`course.path`, …).
    pub fn module_set_props(
        &mut self,
        module: &str,
        page_id: &str,
        props: &BTreeMap<String, Value>,
    ) -> Result<()> {
        let ns = format!("{}.", self.module_info(module)?.manifest.namespace);
        self.approved_caps(module)?;
        if let Some(k) = props
            .keys()
            .find(|k| !k.starts_with(&ns) || k.len() == ns.len())
        {
            return Err(Error::Forbidden(format!(
                "{module} may only set {ns}* props, not {k}"
            )));
        }
        self.transact(page_id, |t| {
            for (k, v) in props {
                if v.is_null() {
                    t.remove_prop(page_id, k)?;
                } else {
                    t.set_prop(page_id, k, v.clone())?;
                }
            }
            Ok(())
        })
    }

    /// The module's own props on a page.
    pub fn module_props(&mut self, module: &str, page_id: &str) -> Result<BTreeMap<String, Value>> {
        let ns = format!("{}.", self.module_info(module)?.manifest.namespace);
        self.approved_caps(module)?;
        Ok(self
            .snapshot(page_id)?
            .root()
            .props
            .iter()
            .filter(|(k, _)| k.starts_with(&ns))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect())
    }

    /// Pages carrying `key = value` in their own props (from the index).
    pub fn pages_with_prop(&self, key: &str, value: &Value) -> Result<Vec<PageId>> {
        Ok(self
            .conn()
            .prepare(
                "SELECT p.page_id FROM props p JOIN page_meta m ON m.id = p.page_id
                 WHERE p.block_id = p.page_id AND p.key = ?1 AND p.value = ?2 AND m.trashed_at IS NULL
                 ORDER BY m.created_at, p.page_id",
            )?
            .query_map(params![key, value.to_string()], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    }
}
