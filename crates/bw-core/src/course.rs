//! The Course module: first-party, compiled into the app, and held to the same capability
//! checks as any other module (see `modules.rs`).
//!
//! - **Setup** creates the Courses and Lessons databases (a two-way relation, progress and
//!   total-minutes rollups, a board and a "To watch" view).
//! - **Import** turns a folder into a course: one lesson per video or document, in natural order
//!   (`2 - …` before `10 - …`), with the subfolder as its section and, for MP4/MOV files, the
//!   duration read from the file.
//! - **Sync** compares the folder with the course again: new files become lessons, lessons whose
//!   file disappeared are flagged *Missing* (never deleted: your notes and ticks stay), and
//!   flagged lessons whose file came back are unflagged. The host runs it when the folder changes.
//! - **Open** checks the lesson's file is in a folder you gave the module, notes the date as
//!   *Last watched*, and moves a not-started course to *In progress*. The host opens the file.
//!
//! What the module stores is ordinary data: rows and columns you can see and edit, plus a few
//! `course.*` props (the course's folder, each lesson's path inside it) that tie them to disk.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::core::Core;
use crate::database::{
    Filter, FilterOp, NewRelation, PropType, Property, RollupConfig, RollupFn, SelectOption, Sort,
    View, ViewKind,
};
use crate::error::{Error, Result};
use crate::modules::ModuleManifest;
use crate::schema::{new_id, PageId, PageMeta};

pub const MODULE_ID: &str = "brainwaves.course";

pub const VIDEO: [&str; 6] = ["mp4", "m4v", "mkv", "webm", "mov", "avi"];
pub const DOCS: [&str; 11] = [
    "pdf", "ppt", "pptx", "key", "md", "txt", "html", "htm", "doc", "docx", "epub",
];

// props
const ROLE: &str = "course.role";
const LESSONS_DB: &str = "course.lessonsDb";
const COURSES_DB: &str = "course.coursesDb";
const LINK: &str = "course.link";
const BACKLINK: &str = "course.backlink";
const FOLDER: &str = "course.folder";
const PATH: &str = "course.path";

pub fn manifest() -> ModuleManifest {
    ModuleManifest {
        id: MODULE_ID.into(),
        name: "Courses".into(),
        description: "Turn a folder of videos and documents into a course, keep it in sync, and track your progress.".into(),
        version: "1".into(),
        icon: "🎓".into(),
        namespace: "course".into(),
        capabilities: vec!["db.own".into(), "fs.pick".into(), "fs.open".into()],
    }
}

/// The two databases of a course tracker.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracker {
    pub courses: PageId,
    pub lessons: PageId,
    /// Default views (for inline database blocks).
    pub courses_view: String,
    pub lessons_view: String,
    /// The Lessons → Course relation column, and its other side on Courses.
    pub link: String,
    pub backlink: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub course: PageId,
    pub added: usize,
    pub missing: usize,
    pub restored: usize,
}

/// A lesson file found on disk.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    /// Path inside the course folder, `/`-separated.
    pub rel: String,
    pub path: PathBuf,
    pub title: String,
    pub section: String,
    pub minutes: Option<u32>,
}

fn prop(id: &str, name: &str, kind: PropType, order: &str) -> Property {
    Property {
        id: id.into(),
        name: name.into(),
        kind,
        order: order.into(),
        options: vec![],
        relation: None,
        rollup: None,
    }
}

fn view(name: &str, kind: ViewKind) -> View {
    View {
        id: new_id(),
        name: name.into(),
        kind,
        order: String::new(),
        filters: vec![],
        sorts: vec![],
        group_by: None,
        hidden: vec![],
    }
}

fn opt(id: &str, name: &str, color: &str) -> SelectOption {
    SelectOption {
        id: id.into(),
        name: name.into(),
        color: color.into(),
    }
}

impl Core {
    /// Register the module (at startup).
    pub fn register_course_module(&mut self) -> Result<()> {
        self.install_module(&manifest(), "", true)
    }

    /// Create the Courses and Lessons databases under `parent`.
    pub fn course_setup(&mut self, parent: Option<&str>) -> Result<Tracker> {
        let m = MODULE_ID;
        let meta = |title: &str, icon: &str| PageMeta {
            title: title.into(),
            icon: icon.into(),
            parent_id: parent.map(String::from),
            ..Default::default()
        };
        let c = self.module_create_database(m, &new_id(), meta("Courses", "🎓"))?;
        let l = self.module_create_database(m, &new_id(), meta("Lessons", "🎬"))?;

        let mut status = prop("status", "Status", PropType::Select, "a1");
        status.options = vec![
            opt("todo", "Not started", "gray"),
            opt("doing", "In progress", "blue"),
            opt("done", "Finished", "green"),
        ];
        self.set_property(&c, status)?;
        self.set_property(&c, prop("folder", "Source folder", PropType::File, "a2"))?;
        self.set_property(&l, prop("order", "Order", PropType::Number, "a1"))?;
        self.set_property(&l, prop("section", "Section", PropType::Text, "a2"))?;
        self.set_property(&l, prop("done", "Done", PropType::Checkbox, "a3"))?;
        self.set_property(
            &l,
            prop("minutes", "Duration (min)", PropType::Number, "a4"),
        )?;
        self.set_property(&l, prop("file", "File", PropType::File, "a5"))?;
        self.set_property(&l, prop("watched", "Last watched", PropType::Date, "a6"))?;
        self.set_property(&l, prop("missing", "Missing", PropType::Checkbox, "a7"))?;

        let (link, backlink) = self.create_relation(
            &l,
            &NewRelation {
                name: "Course".into(),
                target_database: c.clone(),
                two_way: true,
                reverse_name: Some("Lessons".into()),
            },
        )?;
        let backlink = backlink
            .ok_or_else(|| Error::Malformed("two-way relation without a reverse column".into()))?;
        // The Course column right after the name.
        let mut course_col = self.database_def(&l)?.property(&link).cloned().unwrap();
        course_col.order = "a05".into();
        self.set_property(&l, course_col)?;
        let rollup = |id: &str, name: &str, property: &str, function: RollupFn| Property {
            rollup: Some(RollupConfig {
                relation: backlink.clone(),
                property: property.into(),
                function,
            }),
            ..prop(id, name, PropType::Rollup, "a5")
        };
        self.set_property(
            &c,
            rollup("progress", "Progress", "done", RollupFn::PercentChecked),
        )?;
        self.set_property(
            &c,
            rollup("minutes", "Total minutes", "minutes", RollupFn::Sum),
        )?;

        let cdef = self.database_def(&c)?;
        let ldef = self.database_def(&l)?;
        let courses_view = cdef.views[0].id.clone();
        let mut ltable = ldef.views[0].clone();
        ltable.sorts = vec![Sort {
            property: "order".into(),
            desc: false,
        }];
        ltable.hidden = vec!["missing".into()];
        let lessons_view = ltable.id.clone();
        self.set_view(&l, ltable)?;
        let mut board = view("Board", ViewKind::Board);
        board.group_by = Some("status".into());
        board.hidden = vec!["folder".into(), backlink.clone(), "minutes".into()];
        self.set_view(&c, board)?;
        let mut to_watch = view("To watch", ViewKind::Table);
        to_watch.filters = vec![Filter {
            property: "done".into(),
            op: FilterOp::Is,
            value: json!(false),
        }];
        to_watch.sorts = vec![Sort {
            property: "order".into(),
            desc: false,
        }];
        to_watch.hidden = vec![
            "done".into(),
            "file".into(),
            "watched".into(),
            "missing".into(),
        ];
        self.set_view(&l, to_watch)?;

        let s = |v: &str| Value::String(v.to_string());
        self.module_set_props(
            m,
            &c,
            &BTreeMap::from([
                (ROLE.into(), s("courses")),
                (LESSONS_DB.into(), s(&l)),
                (LINK.into(), s(&link)),
                (BACKLINK.into(), s(&backlink)),
            ]),
        )?;
        self.module_set_props(
            m,
            &l,
            &BTreeMap::from([(ROLE.into(), s("lessons")), (COURSES_DB.into(), s(&c))]),
        )?;
        Ok(Tracker {
            courses: c,
            lessons: l,
            courses_view,
            lessons_view,
            link,
            backlink,
        })
    }

    /// The tracker a Courses (or Lessons) database belongs to.
    pub fn course_tracker(&mut self, database_id: &str) -> Result<Tracker> {
        let props = self.module_props(MODULE_ID, database_id)?;
        let get = |p: &BTreeMap<String, Value>, k: &str| {
            p.get(k).and_then(|v| v.as_str()).map(String::from)
        };
        let courses = match get(&props, ROLE).as_deref() {
            Some("courses") => database_id.to_string(),
            Some("lessons") => get(&props, COURSES_DB)
                .ok_or_else(|| Error::Malformed("lessons without courses".into()))?,
            _ => {
                return Err(Error::Invalid(format!(
                    "{database_id} is not a course tracker database"
                )))
            }
        };
        let cp = self.module_props(MODULE_ID, &courses)?;
        let missing = || Error::Malformed(format!("course tracker {courses} is incomplete"));
        let lessons = get(&cp, LESSONS_DB).ok_or_else(missing)?;
        let views = |core: &mut Core, db: &str| {
            core.database_def(db)
                .map(|d| d.views.first().map(|v| v.id.clone()).unwrap_or_default())
        };
        Ok(Tracker {
            courses_view: views(self, &courses)?,
            lessons_view: views(self, &lessons)?,
            link: get(&cp, LINK).ok_or_else(missing)?,
            backlink: get(&cp, BACKLINK).ok_or_else(missing)?,
            courses,
            lessons,
        })
    }

    /// Every course tracker, oldest first.
    pub fn course_trackers(&mut self) -> Result<Vec<Tracker>> {
        let ids = self.pages_with_prop(ROLE, &json!("courses"))?;
        ids.iter().map(|id| self.course_tracker(id)).collect()
    }

    /// Scan a course folder the module may read.
    pub fn course_scan(&self, folder: &str) -> Result<Vec<Found>> {
        let entries = self.fs_list(MODULE_ID, folder, true, 5000)?;
        let mut found: Vec<Found> = entries
            .into_iter()
            .filter(|e| !e.is_dir)
            .filter_map(|e| {
                let ext = Path::new(&e.name)
                    .extension()?
                    .to_string_lossy()
                    .to_lowercase();
                let video = VIDEO.contains(&ext.as_str());
                if !video && !DOCS.contains(&ext.as_str()) {
                    return None;
                }
                let stem = Path::new(&e.name)
                    .file_stem()?
                    .to_string_lossy()
                    .to_string();
                let section = e
                    .rel
                    .rsplit_once('/')
                    .map(|(dir, _)| {
                        dir.split('/')
                            .map(clean_name)
                            .collect::<Vec<_>>()
                            .join(" / ")
                    })
                    .unwrap_or_default();
                let path = PathBuf::from(&e.path);
                let minutes = if video { video_minutes(&path) } else { None };
                Some(Found {
                    rel: e.rel,
                    path,
                    title: clean_name(&stem),
                    section,
                    minutes,
                })
            })
            .collect();
        found.sort_by(|a, b| natural_cmp(&a.rel, &b.rel));
        Ok(found)
    }

    /// Import `folder` (already granted to the module) as a new course in `courses_db`.
    pub fn course_import(&mut self, courses_db: &str, folder: &str) -> Result<SyncReport> {
        let t = self.course_tracker(courses_db)?;
        let real = self.check_read(MODULE_ID, folder)?;
        let real_s = real.to_string_lossy().to_string();
        if let Some(existing) = self
            .course_rows(&t)?
            .into_iter()
            .find(|(_, f)| crate::modules::plain(f) == real)
        {
            return self.course_sync(&existing.0);
        }
        let name = real
            .file_name()
            .map(|n| clean_name(&n.to_string_lossy()))
            .unwrap_or_else(|| "Course".into());
        let id = new_id();
        self.module_create_row(
            MODULE_ID,
            &t.courses,
            &id,
            &name,
            &BTreeMap::from([
                ("status".into(), json!("todo")),
                ("folder".into(), json!(real_s)),
            ]),
        )?;
        self.module_set_props(
            MODULE_ID,
            &id,
            &BTreeMap::from([(FOLDER.into(), json!(real_s))]),
        )?;
        self.course_sync(&id)
    }

    /// Course rows of a tracker with their folders.
    fn course_rows(&mut self, t: &Tracker) -> Result<Vec<(PageId, String)>> {
        let rows = self.module_query(MODULE_ID, &t.courses, None)?.rows;
        let mut out = vec![];
        for r in rows {
            if let Some(f) = self
                .module_props(MODULE_ID, &r.id)?
                .get(FOLDER)
                .and_then(|v| v.as_str())
            {
                out.push((r.id, f.to_string()));
            }
        }
        Ok(out)
    }

    /// Bring a course in line with its folder.
    pub fn course_sync(&mut self, course: &str) -> Result<SyncReport> {
        let meta = self.snapshot(course)?.meta;
        let db = meta
            .database_id
            .ok_or_else(|| Error::Invalid(format!("{course} is not a course")))?;
        let t = self.course_tracker(&db)?;
        let folder = self
            .module_props(MODULE_ID, course)?
            .get(FOLDER)
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| Error::Invalid(format!("{course} has no source folder")))?;
        let mut report = SyncReport {
            course: course.to_string(),
            ..Default::default()
        };
        // A folder that's gone (unplugged drive, revoked access) flags nothing: it's not the
        // lessons that went missing.
        let found = match self.course_scan(&folder) {
            Ok(f) => f,
            Err(Error::Forbidden(e)) => return Err(Error::Forbidden(e)),
            Err(_) => return Ok(report),
        };

        // This course's lessons, by their path in the folder.
        let lessons = self.module_query(MODULE_ID, &t.lessons, None)?.rows;
        let mut known: BTreeMap<String, (PageId, bool, Option<f64>)> = BTreeMap::new();
        for r in lessons {
            let linked = r
                .values
                .get(&t.link)
                .and_then(|v| v.as_array())
                .is_some_and(|a| a.iter().any(|x| x == course));
            if !linked {
                continue;
            }
            if let Some(p) = self
                .module_props(MODULE_ID, &r.id)?
                .get(PATH)
                .and_then(|v| v.as_str())
            {
                let missing = r.values.get("missing") == Some(&json!(true));
                known.insert(
                    p.to_string(),
                    (
                        r.id.clone(),
                        missing,
                        r.values.get("order").and_then(|v| v.as_f64()),
                    ),
                );
            }
        }

        let on_disk: std::collections::BTreeSet<&str> =
            found.iter().map(|f| f.rel.as_str()).collect();
        for (i, f) in found.iter().enumerate() {
            let order = (i + 1) as f64;
            match known.get(&f.rel) {
                Some((id, missing, old_order)) => {
                    if *missing {
                        self.module_set_value(MODULE_ID, id, "missing", json!(false))?;
                        report.restored += 1;
                    }
                    if *old_order != Some(order) {
                        self.module_set_value(MODULE_ID, id, "order", json!(i + 1))?;
                    }
                }
                None => {
                    let id = new_id();
                    let mut values = BTreeMap::from([
                        ("order".to_string(), json!(i + 1)),
                        ("file".to_string(), json!(f.path.to_string_lossy())),
                        (t.link.clone(), json!([course])),
                    ]);
                    if !f.section.is_empty() {
                        values.insert("section".into(), json!(f.section));
                    }
                    if let Some(m) = f.minutes {
                        values.insert("minutes".into(), json!(m));
                    }
                    self.module_create_row(MODULE_ID, &t.lessons, &id, &f.title, &values)?;
                    self.module_set_props(
                        MODULE_ID,
                        &id,
                        &BTreeMap::from([(PATH.into(), json!(f.rel))]),
                    )?;
                    report.added += 1;
                }
            }
        }
        for (rel, (id, missing, _)) in &known {
            if !on_disk.contains(rel.as_str()) && !missing {
                self.module_set_value(MODULE_ID, id, "missing", json!(true))?;
                report.missing += 1;
            }
        }
        Ok(report)
    }

    /// Sync every course whose folder is inside `root` (the host calls this when files change).
    pub fn course_sync_under(&mut self, root: &Path) -> Result<Vec<SyncReport>> {
        let mut out = vec![];
        for t in self.course_trackers()? {
            for (course, folder) in self.course_rows(&t)? {
                let (folder, root) = (crate::modules::plain(&folder), crate::modules::plain(root));
                if folder.starts_with(&root) || root.starts_with(&folder) {
                    let r = self.course_sync(&course)?;
                    if r.added + r.missing + r.restored > 0 {
                        out.push(r);
                    }
                }
            }
        }
        Ok(out)
    }

    /// Get a lesson ready to open: check its file, note today as *Last watched*, start the
    /// course. Returns the file for the host to open.
    pub fn course_open_lesson(&mut self, lesson: &str) -> Result<PathBuf> {
        let snap = self.snapshot(lesson)?;
        let db = snap
            .meta
            .database_id
            .ok_or_else(|| Error::Invalid(format!("{lesson} is not a lesson")))?;
        let t = self.course_tracker(&db)?;
        let row = self
            .module_query(MODULE_ID, &t.lessons, None)?
            .rows
            .into_iter()
            .find(|r| r.id == lesson)
            .ok_or_else(|| Error::Invalid(format!("{lesson} is not in {}", t.lessons)))?;
        let file = row
            .values
            .get("file")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::Invalid("this lesson has no file".into()))?;
        let path = self.fs_open_check(MODULE_ID, file)?;
        self.module_set_value(MODULE_ID, lesson, "watched", json!(today()))?;
        for course in row
            .values
            .get(&t.link)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
        {
            let Some(course) = course.as_str() else {
                continue;
            };
            let status = self
                .module_query(MODULE_ID, &t.courses, None)?
                .rows
                .into_iter()
                .find(|r| r.id == course)
                .and_then(|r| r.values.get("status").cloned());
            if status.is_none() || status == Some(json!("todo")) {
                self.module_set_value(MODULE_ID, course, "status", json!("doing"))?;
            }
        }
        Ok(path)
    }
}

/// "01 - Getting_started" → "Getting started". Keeps the name if nothing else is left.
pub fn clean_name(s: &str) -> String {
    const SEP: [char; 6] = [' ', '.', '-', '_', ')', ']'];
    let rest = s.trim_start_matches(|c: char| c.is_ascii_digit());
    // "2b - Extra": a lowercase letter right after the number is part of it.
    let rest = match rest.chars().next() {
        Some(c) if c.is_ascii_lowercase() && rest[1..].starts_with(SEP) => &rest[1..],
        _ => rest,
    };
    // Only a number followed by a separator is numbering ("3D printing" keeps its 3).
    let t = if rest.len() < s.len() && rest.starts_with(SEP) {
        rest.trim_start_matches(SEP)
    } else {
        s
    };
    let t = t.replace('_', " ");
    let t = t.trim();
    if t.is_empty() {
        s.trim().to_string()
    } else {
        t.to_string()
    }
}

/// Compare with runs of digits as numbers: "2 - b" < "10 - a".
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(c) = a.peek().copied().filter(char::is_ascii_digit) {
                    na.push(c);
                    a.next();
                }
                let mut nb = String::new();
                while let Some(c) = b.peek().copied().filter(char::is_ascii_digit) {
                    nb.push(c);
                    b.next();
                }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then(ta.cmp(tb));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(x), Some(y)) => {
                let o = x.to_lowercase().cmp(y.to_lowercase());
                if o != Ordering::Equal {
                    return o;
                }
                a.next();
                b.next();
            }
        }
    }
}

/// Duration of an MP4 / MOV file in whole minutes (rounded up), from its `moov/mvhd` box.
pub fn video_minutes(path: &Path) -> Option<u32> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    // Find a box of type `want` between `start` and `end`; returns (body start, body end).
    fn find(f: &mut std::fs::File, mut pos: u64, end: u64, want: &[u8; 4]) -> Option<(u64, u64)> {
        while pos + 8 <= end {
            f.seek(SeekFrom::Start(pos)).ok()?;
            let mut h = [0u8; 8];
            f.read_exact(&mut h).ok()?;
            let mut size = u32::from_be_bytes(h[0..4].try_into().ok()?) as u64;
            let mut header = 8;
            if size == 1 {
                let mut big = [0u8; 8];
                f.read_exact(&mut big).ok()?;
                size = u64::from_be_bytes(big);
                header = 16;
            } else if size == 0 {
                size = end - pos;
            }
            if size < header {
                return None;
            }
            if &h[4..8] == want {
                return Some((pos + header, (pos + size).min(end)));
            }
            pos += size;
        }
        None
    }
    let (moov, moov_end) = find(&mut f, 0, len, b"moov")?;
    let (mvhd, _) = find(&mut f, moov, moov_end, b"mvhd")?;
    f.seek(SeekFrom::Start(mvhd)).ok()?;
    let mut b = [0u8; 32];
    f.read_exact(&mut b).ok()?;
    let (scale, duration) = if b[0] == 1 {
        (
            u32::from_be_bytes(b[20..24].try_into().ok()?) as u64,
            u64::from_be_bytes(b[24..32].try_into().ok()?),
        )
    } else {
        (
            u32::from_be_bytes(b[12..16].try_into().ok()?) as u64,
            u32::from_be_bytes(b[16..20].try_into().ok()?) as u64,
        )
    };
    if scale == 0 {
        return None;
    }
    Some(((duration as f64 / scale as f64) / 60.0).ceil().max(1.0) as u32)
}

/// Today's date (UTC) as `YYYY-MM-DD`.
pub fn today() -> String {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}
