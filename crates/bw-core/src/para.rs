//! The PARA module: Tiago Forte's Projects / Areas / Resources / Archives, with an Inbox in
//! front of it to capture into. First-party, compiled in, held to the same checks as any module.
//!
//! A *space* is a page (the hub) with four databases under it:
//!
//! - **Inbox**: quick notes. Status (inbox / processed / someday), type, links to projects,
//!   areas and resources, a source URL and a pin. An empty status counts as *inbox*, so a row
//!   added straight from the table lands in the Inbox view.
//! - **Projects**: status, deadline, area, outcome and next action (required), plus priority,
//!   review date, timeframe and stakeholders (optional, hidden in the default views).
//! - **Areas**: the standard to keep, health, review cadence and last review. The projects of
//!   an area are the other side of the project's *Area* column; [`Core::para_overview`] counts
//!   the active ones and flags areas whose review is overdue.
//! - **Resources**: domain and type, linked to areas and projects.
//!
//! The archive is not a fifth database: every database has *Archived*, *Archived on* and
//! *Archive reason* columns, an *Archive* view, and the page itself is marked archived (so the
//! app shows it muted). [`Core::para_overview`] lists the whole archive, newest first.
//!
//! Triage:
//! - [`Core::para_promote`] turns an inbox note into a project. The row moves to Projects (same
//!   page, so its content, backlinks and tags stay), takes the project fields, its first linked
//!   area becomes the project's area and its linked resources stay linked.
//! - [`Core::para_process`] adds links to a note and marks it processed.
//!
//! Columns keep the same id across the four databases where they mean the same thing (tags and
//! the archive columns), so a promoted note keeps them as they are.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::core::Core;
use crate::course::today;
use crate::database::{
    Filter, FilterOp, NewRelation, PropType, Property, SelectOption, Sort, View, ViewKind,
};
use crate::error::{Error, Result};
use crate::modules::ModuleManifest;
use crate::schema::{new_id, PageId, PageMeta, PageMetaPatch};

pub const MODULE_ID: &str = "brainwaves.para";

// Module props: on the hub, the whole space; on each database, its role and the hub.
const ROLE: &str = "para.role";
const SPACE: &str = "para.space";
const CONFIG: &str = "para.config";

// Column ids (stable, shared where the meaning is shared).
pub const TAGS: &str = "tags";
pub const ARCHIVED: &str = "archived";
pub const ARCHIVED_AT: &str = "archivedAt";
pub const ARCHIVE_REASON: &str = "archiveReason";
pub const INBOX_STATUS: &str = "inboxStatus";
pub const NOTE_TYPE: &str = "noteType";
pub const SOURCE: &str = "source";
pub const PINNED: &str = "pinned";
pub const STATUS: &str = "status";
pub const DEADLINE: &str = "deadline";
pub const OUTCOME: &str = "outcome";
pub const NEXT_ACTION: &str = "nextAction";
pub const PRIORITY: &str = "priority";
pub const REVIEW_DATE: &str = "reviewDate";
pub const TIMEFRAME: &str = "timeframe";
pub const STAKEHOLDERS: &str = "stakeholders";
pub const STANDARD: &str = "standard";
pub const HEALTH: &str = "health";
pub const CADENCE: &str = "cadence";
pub const LAST_REVIEWED: &str = "lastReviewed";
pub const DOMAIN: &str = "domain";
pub const RESOURCE_TYPE: &str = "resourceType";

/// Columns only an inbox note has: dropped when it becomes a project.
const NOTE_ONLY: [&str; 4] = [INBOX_STATUS, NOTE_TYPE, SOURCE, PINNED];
/// Project statuses that count as active.
const ACTIVE: [&str; 2] = ["not_started", "in_progress"];

pub fn manifest() -> ModuleManifest {
    ModuleManifest {
        id: MODULE_ID.into(),
        name: "PARA".into(),
        description: "Projects, Areas, Resources and Archives, with an Inbox to capture into and triage from.".into(),
        version: "1".into(),
        icon: "🗂️".into(),
        namespace: "para".into(),
        capabilities: vec!["db.own".into()],
    }
}

/// Where everything of a PARA space is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub hub: PageId,
    pub inbox: PageId,
    pub projects: PageId,
    pub areas: PageId,
    pub resources: PageId,
    /// Saved views by name, per database (`views.inbox.Inbox` = view id).
    pub views: BTreeMap<String, BTreeMap<String, String>>,
    /// Relation columns: `noteProjects`, `noteAreas`, `noteResources` (on Inbox), `projectArea`
    /// (on Projects), `areaProjects` (its other side, on Areas), `resourceAreas`,
    /// `resourceProjects` (on Resources) and their other sides `areaResources`,
    /// `projectResources`.
    pub columns: BTreeMap<String, String>,
}

impl Space {
    fn col(&self, k: &str) -> Result<&str> {
        self.columns
            .get(k)
            .map(String::as_str)
            .ok_or_else(|| Error::Malformed(format!("PARA space without its {k} column")))
    }

    /// The role of a database of this space.
    pub fn role_of(&self, database_id: &str) -> Option<&'static str> {
        [
            (&self.inbox, "inbox"),
            (&self.projects, "projects"),
            (&self.areas, "areas"),
            (&self.resources, "resources"),
        ]
        .into_iter()
        .find(|(id, _)| id.as_str() == database_id)
        .map(|(_, r)| r)
    }
}

/// What [`Core::para_promote`] sets on the new project. Missing fields get defaults (status
/// *Not started*; the area from the note's first linked area).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Promote {
    pub status: Option<String>,
    pub deadline: Option<String>,
    pub area: Option<PageId>,
    pub outcome: Option<String>,
    pub next_action: Option<String>,
    pub priority: Option<String>,
}

/// Links [`Core::para_process`] adds to a note.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Links {
    pub projects: Vec<PageId>,
    pub areas: Vec<PageId>,
    pub resources: Vec<PageId>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaHealth {
    pub id: PageId,
    pub title: String,
    pub icon: String,
    pub health: Option<String>,
    pub cadence: Option<String>,
    pub last_reviewed: Option<String>,
    pub active_projects: usize,
    /// Days until the next review is due (negative: overdue by that many days). `None` when
    /// the area was never reviewed or has no cadence.
    pub due_in: Option<i64>,
    pub overdue: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDue {
    pub id: PageId,
    pub title: String,
    pub icon: String,
    pub status: Option<String>,
    pub deadline: Option<String>,
    pub next_action: Option<String>,
    pub area: Option<PageId>,
    pub overdue: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Archived {
    pub id: PageId,
    pub title: String,
    pub icon: String,
    /// note, project, area or resource.
    pub kind: String,
    pub database_id: PageId,
    pub archived_at: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxNote {
    pub id: PageId,
    pub title: String,
    pub icon: String,
    pub pinned: bool,
    pub note_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub space: Space,
    pub today: String,
    /// Notes waiting in the Inbox.
    pub inbox: usize,
    /// Those notes, in the Inbox view's order (pinned first, then newest).
    pub inbox_notes: Vec<InboxNote>,
    pub someday: usize,
    /// Areas, those needing attention first (the Areas Dashboard order).
    pub areas: Vec<AreaHealth>,
    /// Active projects, soonest deadline first.
    pub projects: Vec<ProjectDue>,
    /// The global archive, most recently archived first.
    pub archive: Vec<Archived>,
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

fn select(
    id: &str,
    name: &str,
    kind: PropType,
    order: &str,
    opts: &[(&str, &str, &str)],
) -> Property {
    let mut p = prop(id, name, kind, order);
    p.options = opts
        .iter()
        .map(|(id, name, color)| SelectOption {
            id: (*id).into(),
            name: (*name).into(),
            color: (*color).into(),
        })
        .collect();
    p
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

fn is(property: &str, op: FilterOp, value: Value) -> Filter {
    Filter {
        property: property.into(),
        op,
        value,
    }
}

fn sort(property: &str, desc: bool) -> Sort {
    Sort {
        property: property.into(),
        desc,
    }
}

const STATUS_OPTS: [(&str, &str, &str); 5] = [
    ("not_started", "Not started", "gray"),
    ("in_progress", "In progress", "blue"),
    ("on_hold", "On hold", "yellow"),
    ("completed", "Completed", "green"),
    ("canceled", "Canceled", "red"),
];
const REASONS: [(&str, &str, &str); 4] = [
    ("completed", "Completed", "green"),
    ("canceled", "Canceled", "red"),
    ("on_ice", "On ice", "blue"),
    ("deprecated", "Deprecated", "gray"),
];

/// Days since 1970-01-01 of a `YYYY-MM-DD` date (the date part of a longer value too).
pub fn day_number(date: &str) -> Option<i64> {
    let d = date.get(..10)?;
    let mut it = d.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let d: i64 = it.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // Howard Hinnant's days-from-civil.
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// Days between reviews for a cadence.
pub fn cadence_days(cadence: &str) -> Option<i64> {
    match cadence {
        "weekly" => Some(7),
        "monthly" => Some(30),
        "quarterly" => Some(91),
        _ => None,
    }
}

fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

impl Core {
    pub fn register_para_module(&mut self) -> Result<()> {
        self.install_module(&manifest(), "", true)
    }

    /// Create a PARA space (the hub page and its four databases) under `parent`.
    pub fn para_setup(&mut self, parent: Option<&str>) -> Result<Space> {
        let m = MODULE_ID;
        let hub = self.create_page_with_id(
            &new_id(),
            PageMeta {
                title: "PARA".into(),
                icon: "🗂️".into(),
                parent_id: parent.map(String::from),
                ..Default::default()
            },
        )?;
        let meta = |title: &str, icon: &str| PageMeta {
            title: title.into(),
            icon: icon.into(),
            parent_id: Some(hub.clone()),
            ..Default::default()
        };
        let inbox = self.module_create_database(m, &new_id(), meta("Inbox", "📥"))?;
        let projects = self.module_create_database(m, &new_id(), meta("Projects", "🚀"))?;
        let areas = self.module_create_database(m, &new_id(), meta("Areas", "🧭"))?;
        let resources = self.module_create_database(m, &new_id(), meta("Resources", "📚"))?;

        use PropType::*;
        // Inbox
        self.set_property(
            &inbox,
            select(
                INBOX_STATUS,
                "Status",
                Select,
                "a1",
                &[
                    ("inbox", "Inbox", "blue"),
                    ("processed", "Processed", "green"),
                    ("someday", "Someday", "purple"),
                ],
            ),
        )?;
        self.set_property(
            &inbox,
            select(
                NOTE_TYPE,
                "Type",
                Select,
                "a2",
                &[
                    ("idea", "Idea", "yellow"),
                    ("scratchpad", "Scratchpad", "gray"),
                    ("reference", "Reference", "blue"),
                    ("meeting", "Meeting", "pink"),
                ],
            ),
        )?;
        self.set_property(&inbox, prop(SOURCE, "Source", Url, "a6"))?;
        self.set_property(&inbox, prop(PINNED, "Pinned", Checkbox, "a7"))?;
        // Projects
        self.set_property(
            &projects,
            select(STATUS, "Status", Select, "a1", &STATUS_OPTS),
        )?;
        self.set_property(&projects, prop(DEADLINE, "Deadline", Date, "a2"))?;
        self.set_property(&projects, prop(OUTCOME, "Outcome", Text, "a4"))?;
        self.set_property(&projects, prop(NEXT_ACTION, "Next action", Text, "a5"))?;
        self.set_property(
            &projects,
            select(
                PRIORITY,
                "Priority",
                Select,
                "b1",
                &[
                    ("high", "High", "red"),
                    ("medium", "Medium", "yellow"),
                    ("low", "Low", "gray"),
                ],
            ),
        )?;
        self.set_property(&projects, prop(REVIEW_DATE, "Review date", Date, "b2"))?;
        self.set_property(
            &projects,
            select(
                TIMEFRAME,
                "Timeframe",
                Select,
                "b3",
                &[
                    ("q1", "Q1", "blue"),
                    ("q2", "Q2", "green"),
                    ("q3", "Q3", "yellow"),
                    ("q4", "Q4", "orange"),
                ],
            ),
        )?;
        self.set_property(&projects, prop(STAKEHOLDERS, "Stakeholders", Text, "b4"))?;
        // Areas (health in "needs attention first" order: that is how the dashboard sorts)
        self.set_property(&areas, prop(STANDARD, "Standard", Text, "a1"))?;
        self.set_property(
            &areas,
            select(
                HEALTH,
                "Health",
                Select,
                "a2",
                &[
                    ("critical", "Critical", "red"),
                    ("needs_attention", "Needs attention", "yellow"),
                    ("on_track", "On track", "green"),
                ],
            ),
        )?;
        self.set_property(
            &areas,
            select(
                CADENCE,
                "Review cadence",
                Select,
                "a3",
                &[
                    ("weekly", "Weekly", "blue"),
                    ("monthly", "Monthly", "purple"),
                    ("quarterly", "Quarterly", "gray"),
                ],
            ),
        )?;
        self.set_property(&areas, prop(LAST_REVIEWED, "Last reviewed", Date, "a4"))?;
        // Resources (domains grow as you type new ones)
        self.set_property(&resources, prop(DOMAIN, "Domain", Select, "a1"))?;
        self.set_property(
            &resources,
            select(
                RESOURCE_TYPE,
                "Type",
                Select,
                "a2",
                &[
                    ("wiki", "Wiki", "blue"),
                    ("asset_template", "Asset / template", "orange"),
                    ("bookmark", "Bookmark", "yellow"),
                    ("media_course", "Media / course", "purple"),
                ],
            ),
        )?;
        // Shared: tags and the archive columns.
        for db in [&inbox, &projects, &areas, &resources] {
            self.set_property(db, prop(TAGS, "Tags", MultiSelect, "c1"))?;
            self.set_property(db, prop(ARCHIVED, "Archived", Checkbox, "d1"))?;
            self.set_property(db, prop(ARCHIVED_AT, "Archived on", Date, "d2"))?;
            self.set_property(
                db,
                select(ARCHIVE_REASON, "Archive reason", Select, "d3", &REASONS),
            )?;
        }

        // Relations.
        let mut columns = BTreeMap::new();
        let mut relate = |core: &mut Core,
                          from: &str,
                          to: &str,
                          name: &str,
                          reverse: &str,
                          order: &str,
                          keys: (&str, &str)|
         -> Result<()> {
            let (fwd, back) = core.create_relation(
                from,
                &NewRelation {
                    name: name.into(),
                    target_database: to.into(),
                    two_way: true,
                    reverse_name: Some(reverse.into()),
                },
            )?;
            let back =
                back.ok_or_else(|| Error::Malformed("relation without its other side".into()))?;
            let mut col = core.database_def(from)?.property(&fwd).cloned().unwrap();
            col.order = order.into();
            core.set_property(from, col)?;
            let mut col = core.database_def(to)?.property(&back).cloned().unwrap();
            col.order = format!("e{order}");
            core.set_property(to, col)?;
            columns.insert(keys.0.to_string(), fwd);
            columns.insert(keys.1.to_string(), back);
            Ok(())
        };
        relate(
            self,
            &inbox,
            &projects,
            "Projects",
            "Notes",
            "a3",
            ("noteProjects", "projectNotes"),
        )?;
        relate(
            self,
            &inbox,
            &areas,
            "Areas",
            "Notes",
            "a4",
            ("noteAreas", "areaNotes"),
        )?;
        relate(
            self,
            &inbox,
            &resources,
            "Resources",
            "Notes",
            "a5",
            ("noteResources", "resourceNotes"),
        )?;
        relate(
            self,
            &projects,
            &areas,
            "Area",
            "Projects",
            "a3",
            ("projectArea", "areaProjects"),
        )?;
        relate(
            self,
            &resources,
            &areas,
            "Areas",
            "Resources",
            "a3",
            ("resourceAreas", "areaResources"),
        )?;
        relate(
            self,
            &resources,
            &projects,
            "Projects",
            "Resources",
            "a4",
            ("resourceProjects", "projectResources"),
        )?;

        // Views. Every list hides the archive columns; the archive views show them.
        let archive_cols = || {
            vec![
                ARCHIVED.to_string(),
                ARCHIVED_AT.into(),
                ARCHIVE_REASON.into(),
            ]
        };
        let live = || is(ARCHIVED, FilterOp::Is, json!(false));
        let mut views: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        let mut save =
            |core: &mut Core, db: &str, role: &str, v: View, first: bool| -> Result<()> {
                let mut v = v;
                if first {
                    // Reuse the database's own first view, so it opens on this one.
                    v.id = core.database_def(db)?.views[0].id.clone();
                    v.order = core.database_def(db)?.views[0].order.clone();
                }
                views
                    .entry(role.into())
                    .or_default()
                    .insert(v.name.clone(), v.id.clone());
                core.set_view(db, v)
            };
        let archive_view = || {
            let mut v = view("Archive", ViewKind::Table);
            v.filters = vec![is(ARCHIVED, FilterOp::Is, json!(true))];
            v.sorts = vec![sort(ARCHIVED_AT, true)];
            v.hidden = vec![ARCHIVED.into()];
            v
        };
        let notes_cols = |core: &mut Core, db: &str| -> Result<Vec<String>> {
            Ok(core
                .database_def(db)?
                .properties
                .iter()
                .filter(|p| p.name == "Notes" && p.kind == PropType::Relation)
                .map(|p| p.id.clone())
                .collect())
        };

        let mut v = view("Inbox", ViewKind::Table);
        v.filters = vec![
            is(INBOX_STATUS, FilterOp::IsNot, json!("processed")),
            is(INBOX_STATUS, FilterOp::IsNot, json!("someday")),
            live(),
        ];
        v.sorts = vec![sort(PINNED, true), sort("createdAt", true)];
        v.hidden = [archive_cols(), vec![INBOX_STATUS.into(), SOURCE.into()]].concat();
        save(self, &inbox, "inbox", v, true)?;
        let mut v = view("Someday", ViewKind::Table);
        v.filters = vec![is(INBOX_STATUS, FilterOp::Is, json!("someday")), live()];
        v.sorts = vec![sort("createdAt", true)];
        v.hidden = archive_cols();
        save(self, &inbox, "inbox", v, false)?;
        let mut v = view("Processed", ViewKind::Table);
        v.filters = vec![is(INBOX_STATUS, FilterOp::Is, json!("processed")), live()];
        v.sorts = vec![sort("updatedAt", true)];
        v.hidden = archive_cols();
        save(self, &inbox, "inbox", v, false)?;
        save(self, &inbox, "inbox", archive_view(), false)?;

        let optional = vec![
            PRIORITY.to_string(),
            REVIEW_DATE.into(),
            TIMEFRAME.into(),
            STAKEHOLDERS.into(),
        ];
        let project_notes = notes_cols(self, &projects)?;
        let mut v = view("Active projects", ViewKind::Table);
        v.filters = vec![
            is(STATUS, FilterOp::IsNot, json!("completed")),
            is(STATUS, FilterOp::IsNot, json!("canceled")),
            live(),
        ];
        v.sorts = vec![sort(DEADLINE, false)];
        v.hidden = [archive_cols(), optional.clone(), project_notes.clone()].concat();
        save(self, &projects, "projects", v, true)?;
        let mut v = view("Board", ViewKind::Board);
        v.group_by = Some(STATUS.into());
        v.filters = vec![live()];
        v.sorts = vec![sort(DEADLINE, false)];
        v.hidden = [archive_cols(), optional, project_notes].concat();
        save(self, &projects, "projects", v, false)?;
        save(self, &projects, "projects", archive_view(), false)?;

        let mut v = view("Areas dashboard", ViewKind::Table);
        v.filters = vec![live()];
        v.sorts = vec![sort(HEALTH, false), sort(LAST_REVIEWED, false)];
        v.hidden = [archive_cols(), notes_cols(self, &areas)?].concat();
        save(self, &areas, "areas", v, true)?;
        save(self, &areas, "areas", archive_view(), false)?;

        let mut v = view("Library", ViewKind::Table);
        v.filters = vec![live()];
        v.sorts = vec![sort("updatedAt", true)];
        v.hidden = [archive_cols(), notes_cols(self, &resources)?].concat();
        save(self, &resources, "resources", v, true)?;
        let mut v = view("By domain", ViewKind::Board);
        v.group_by = Some(DOMAIN.into());
        v.filters = vec![live()];
        v.hidden = archive_cols();
        save(self, &resources, "resources", v, false)?;
        save(self, &resources, "resources", archive_view(), false)?;

        let space = Space {
            hub: hub.clone(),
            inbox,
            projects,
            areas,
            resources,
            views,
            columns,
        };
        let s = |v: &str| Value::String(v.to_string());
        self.module_set_props(
            m,
            &hub,
            &BTreeMap::from([
                (ROLE.into(), s("space")),
                (
                    CONFIG.into(),
                    serde_json::to_value(&space).map_err(|e| Error::Malformed(e.to_string()))?,
                ),
            ]),
        )?;
        for (db, role) in [
            (&space.inbox, "inbox"),
            (&space.projects, "projects"),
            (&space.areas, "areas"),
            (&space.resources, "resources"),
        ] {
            self.module_set_props(
                m,
                db,
                &BTreeMap::from([(ROLE.into(), s(role)), (SPACE.into(), s(&hub))]),
            )?;
        }
        Ok(space)
    }

    /// The space a page belongs to: its hub, one of its databases, or a row of one.
    pub fn para_space(&mut self, page_id: &str) -> Result<Space> {
        let not = || Error::Invalid(format!("{page_id} is not part of a PARA space"));
        let mut id = page_id.to_string();
        for _ in 0..3 {
            let props = self.module_props(MODULE_ID, &id)?;
            match props.get(ROLE).and_then(|v| v.as_str()) {
                Some("space") => {
                    let cfg = props
                        .get(CONFIG)
                        .cloned()
                        .ok_or_else(|| Error::Malformed("PARA space without its config".into()))?;
                    return serde_json::from_value(cfg)
                        .map_err(|e| Error::Malformed(e.to_string()));
                }
                Some(_) => id = str_of(props.get(SPACE)).ok_or_else(not)?,
                None => id = self.snapshot(&id)?.meta.database_id.ok_or_else(not)?,
            }
        }
        Err(not())
    }

    /// Every PARA space, oldest first.
    pub fn para_spaces(&mut self) -> Result<Vec<Space>> {
        let ids = self.pages_with_prop(ROLE, &json!("space"))?;
        ids.iter().map(|id| self.para_space(id)).collect()
    }

    fn para_row(&mut self, row_id: &str) -> Result<(Space, &'static str)> {
        let space = self.para_space(row_id)?;
        let db = self
            .snapshot(row_id)?
            .meta
            .database_id
            .ok_or_else(|| Error::Invalid(format!("{row_id} is not a database row")))?;
        let role = space
            .role_of(&db)
            .ok_or_else(|| Error::Invalid(format!("{row_id} is not a row of this PARA space")))?;
        Ok((space, role))
    }

    fn row_value(&mut self, row_id: &str, prop_id: &str) -> Result<Option<Value>> {
        Ok(self
            .snapshot(row_id)?
            .root()
            .props
            .get(&format!("db.{prop_id}"))
            .cloned())
    }

    fn add_links(&mut self, row_id: &str, prop_id: &str, ids: &[PageId]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut current = crate::database::ids_of(self.row_value(row_id, prop_id)?.as_ref());
        for id in ids {
            if !current.contains(id) {
                current.push(id.clone());
            }
        }
        self.set_value(row_id, prop_id, json!(current))
    }

    /// Promote an inbox note to a project (see the module docs). Returns the project's id,
    /// which is the note's.
    pub fn para_promote(&mut self, note: &str, p: &Promote) -> Result<PageId> {
        let (space, role) = self.para_row(note)?;
        if role != "inbox" {
            return Err(Error::Invalid(
                "only an inbox note can become a project".into(),
            ));
        }
        let (np, na, nr) = (
            space.col("noteProjects")?.to_string(),
            space.col("noteAreas")?.to_string(),
            space.col("noteResources")?.to_string(),
        );
        let areas = crate::database::ids_of(self.row_value(note, &na)?.as_ref());
        let resources = crate::database::ids_of(self.row_value(note, &nr)?.as_ref());
        let drop: Vec<String> = NOTE_ONLY
            .iter()
            .map(|s| s.to_string())
            .chain([np, na, nr])
            .map(|c| format!("db.{c}"))
            .collect();
        self.transact(note, |tx| {
            drop.iter().try_for_each(|k| tx.remove_prop(note, k))
        })?;
        self.update_page(
            note,
            &PageMetaPatch {
                database_id: Some(Some(space.projects.clone())),
                parent_id: Some(Some(space.projects.clone())),
                key: Some(format!("r{:013}", crate::store::now_millis())),
                ..Default::default()
            },
        )?;
        let set = |core: &mut Core, k: &str, v: Option<String>| -> Result<()> {
            match v.filter(|s| !s.is_empty()) {
                Some(v) => core.set_value(note, k, json!(v)),
                None => Ok(()),
            }
        };
        set(
            self,
            STATUS,
            Some(p.status.clone().unwrap_or_else(|| "not_started".into())),
        )?;
        set(self, DEADLINE, p.deadline.clone())?;
        set(self, OUTCOME, p.outcome.clone())?;
        set(self, NEXT_ACTION, p.next_action.clone())?;
        set(self, PRIORITY, p.priority.clone())?;
        if let Some(area) = p.area.clone().or_else(|| areas.first().cloned()) {
            self.set_value(note, space.col("projectArea")?, json!([area]))?;
        }
        // The resources keep the link, now to the project (stored on the resource side).
        let rp = space.col("resourceProjects")?.to_string();
        for r in resources {
            self.add_links(&r, &rp, &[note.to_string()])?;
        }
        Ok(note.to_string())
    }

    /// Link an inbox note to projects, areas and resources, and mark it processed.
    pub fn para_process(&mut self, note: &str, links: &Links) -> Result<()> {
        let (space, role) = self.para_row(note)?;
        if role != "inbox" {
            return Err(Error::Invalid("only an inbox note can be processed".into()));
        }
        self.add_links(note, space.col("noteProjects")?, &links.projects)?;
        self.add_links(note, space.col("noteAreas")?, &links.areas)?;
        self.add_links(note, space.col("noteResources")?, &links.resources)?;
        self.set_value(note, INBOX_STATUS, json!("processed"))
    }

    /// Archive any row of a space, with a reason. Archiving a project as completed or canceled
    /// sets its status to match.
    pub fn para_archive(&mut self, row: &str, reason: Option<&str>) -> Result<()> {
        let (_, role) = self.para_row(row)?;
        self.set_value(row, ARCHIVED, json!(true))?;
        self.set_value(row, ARCHIVED_AT, json!(today()))?;
        match reason.filter(|r| !r.is_empty()) {
            Some(r) => self.set_value(row, ARCHIVE_REASON, json!(r))?,
            None => self.set_value(row, ARCHIVE_REASON, Value::Null)?,
        }
        if role == "projects" && matches!(reason, Some("completed" | "canceled")) {
            self.set_value(row, STATUS, json!(reason.unwrap()))?;
        }
        self.update_page(
            row,
            &PageMetaPatch {
                archived: Some(true),
                ..Default::default()
            },
        )
    }

    /// Bring a row back from the archive (the reason and date are cleared).
    pub fn para_unarchive(&mut self, row: &str) -> Result<()> {
        self.para_row(row)?;
        self.set_value(row, ARCHIVED, json!(false))?;
        self.set_value(row, ARCHIVED_AT, Value::Null)?;
        self.set_value(row, ARCHIVE_REASON, Value::Null)?;
        self.update_page(
            row,
            &PageMetaPatch {
                archived: Some(false),
                ..Default::default()
            },
        )
    }

    /// Note today as an area's last review.
    pub fn para_reviewed(&mut self, area: &str) -> Result<()> {
        let (_, role) = self.para_row(area)?;
        if role != "areas" {
            return Err(Error::Invalid("only an area is reviewed".into()));
        }
        self.set_value(area, LAST_REVIEWED, json!(today()))
    }

    /// Counts, area health, active projects and the archive of a space.
    pub fn para_overview(&mut self, page_id: &str) -> Result<Overview> {
        self.para_overview_on(page_id, &today())
    }

    pub fn para_overview_on(&mut self, page_id: &str, today: &str) -> Result<Overview> {
        let space = self.para_space(page_id)?;
        let now = day_number(today).unwrap_or(0);
        let all = |core: &mut Core, db: &str| {
            let mut v = view("all", ViewKind::Table);
            v.id = String::new();
            core.query_database(db, None, Some(v)).map(|r| r.rows)
        };
        let archived = |r: &crate::db_query::Row| {
            r.values.get(ARCHIVED).and_then(|v| v.as_bool()) == Some(true)
        };
        let mut archive = Vec::new();
        let mut collect = |rows: &[crate::db_query::Row], kind: &str, db: &str| {
            for r in rows.iter().filter(|r| archived(r)) {
                archive.push(Archived {
                    id: r.id.clone(),
                    title: r.title.clone(),
                    icon: r.icon.clone(),
                    kind: kind.into(),
                    database_id: db.into(),
                    archived_at: str_of(r.values.get(ARCHIVED_AT)),
                    reason: str_of(r.values.get(ARCHIVE_REASON)),
                });
            }
        };

        let notes = all(self, &space.inbox)?;
        collect(&notes, "note", &space.inbox);
        let status = |r: &crate::db_query::Row| str_of(r.values.get(INBOX_STATUS));
        let mut waiting: Vec<&crate::db_query::Row> = notes
            .iter()
            .filter(|r| {
                !archived(r) && !matches!(status(r).as_deref(), Some("processed" | "someday"))
            })
            .collect();
        let pinned =
            |r: &crate::db_query::Row| r.values.get(PINNED).and_then(|v| v.as_bool()) == Some(true);
        waiting.sort_by(|a, b| {
            pinned(b)
                .cmp(&pinned(a))
                .then(b.created_at.cmp(&a.created_at))
        });
        let inbox = waiting.len();
        let inbox_notes = waiting
            .iter()
            .map(|r| InboxNote {
                id: r.id.clone(),
                title: r.title.clone(),
                icon: r.icon.clone(),
                pinned: pinned(r),
                note_type: str_of(r.values.get(NOTE_TYPE)),
            })
            .collect();
        let someday = notes
            .iter()
            .filter(|r| !archived(r) && status(r).as_deref() == Some("someday"))
            .count();

        let project_rows = all(self, &space.projects)?;
        collect(&project_rows, "project", &space.projects);
        let pa = space.col("projectArea")?.to_string();
        let active: Vec<&crate::db_query::Row> = project_rows
            .iter()
            .filter(|r| !archived(r))
            .filter(|r| match str_of(r.values.get(STATUS)) {
                Some(s) => ACTIVE.contains(&s.as_str()),
                None => true,
            })
            .collect();
        let mut projects: Vec<ProjectDue> = project_rows
            .iter()
            .filter(|r| !archived(r))
            .filter(|r| {
                !matches!(
                    str_of(r.values.get(STATUS)).as_deref(),
                    Some("completed" | "canceled")
                )
            })
            .map(|r| {
                let deadline = str_of(r.values.get(DEADLINE));
                ProjectDue {
                    id: r.id.clone(),
                    title: r.title.clone(),
                    icon: r.icon.clone(),
                    status: str_of(r.values.get(STATUS)),
                    overdue: deadline
                        .as_deref()
                        .and_then(day_number)
                        .is_some_and(|d| d < now),
                    deadline,
                    next_action: str_of(r.values.get(NEXT_ACTION)),
                    area: crate::database::ids_of(r.values.get(&pa))
                        .into_iter()
                        .next(),
                }
            })
            .collect();
        projects.sort_by(|a, b| match (&a.deadline, &b.deadline) {
            (Some(x), Some(y)) => x.cmp(y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        });

        let area_rows = all(self, &space.areas)?;
        collect(&area_rows, "area", &space.areas);
        let mut areas: Vec<AreaHealth> = area_rows
            .iter()
            .filter(|r| !archived(r))
            .map(|r| {
                let cadence = str_of(r.values.get(CADENCE));
                let last = str_of(r.values.get(LAST_REVIEWED));
                let due_in = match (
                    cadence.as_deref().and_then(cadence_days),
                    last.as_deref().and_then(day_number),
                ) {
                    (Some(c), Some(l)) => Some(l + c - now),
                    _ => None,
                };
                AreaHealth {
                    id: r.id.clone(),
                    title: r.title.clone(),
                    icon: r.icon.clone(),
                    health: str_of(r.values.get(HEALTH)),
                    active_projects: active
                        .iter()
                        .filter(|p| crate::database::ids_of(p.values.get(&pa)).contains(&r.id))
                        .count(),
                    // Never reviewed (with a cadence) counts as overdue.
                    overdue: due_in.map_or(cadence.is_some() && last.is_none(), |d| d < 0),
                    due_in,
                    cadence,
                    last_reviewed: last,
                }
            })
            .collect();
        let rank = |h: &Option<String>| match h.as_deref() {
            Some("critical") => 0,
            Some("needs_attention") => 1,
            Some("on_track") => 2,
            _ => 3,
        };
        areas.sort_by(|a, b| {
            rank(&a.health).cmp(&rank(&b.health)).then_with(|| {
                match (&a.last_reviewed, &b.last_reviewed) {
                    (Some(x), Some(y)) => x.cmp(y),
                    (None, Some(_)) => std::cmp::Ordering::Less,
                    (Some(_), None) => std::cmp::Ordering::Greater,
                    _ => std::cmp::Ordering::Equal,
                }
            })
        });

        let resource_rows = all(self, &space.resources)?;
        collect(&resource_rows, "resource", &space.resources);
        archive.sort_by(|a, b| b.archived_at.cmp(&a.archived_at));

        Ok(Overview {
            space,
            today: today.to_string(),
            inbox,
            inbox_notes,
            someday,
            areas,
            projects,
            archive,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core() -> Core {
        Core::open_in_memory().unwrap()
    }

    #[test]
    fn day_numbers() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2026-11-23"), Some(20_780));
        assert_eq!(day_number("2026-11-23T10:00"), Some(20_780));
        assert_eq!(day_number("nope"), None);
    }

    #[test]
    fn setup_makes_four_linked_databases() {
        let mut c = core();
        let s = c.para_setup(None).unwrap();
        assert_eq!(c.para_spaces().unwrap(), vec![s.clone()]);
        assert_eq!(c.para_space(&s.inbox).unwrap(), s);
        let inbox = c.database_def(&s.inbox).unwrap();
        assert_eq!(inbox.views[0].name, "Inbox");
        assert!(inbox.property(TAGS).is_some());
        let areas = c.database_def(&s.areas).unwrap();
        assert!(areas.property(s.col("areaProjects").unwrap()).is_some());
        assert_eq!(s.views["projects"].len(), 3);
    }

    #[test]
    fn inbox_view_shows_new_notes_pinned_first() {
        let mut c = core();
        let s = c.para_setup(None).unwrap();
        let none = BTreeMap::new();
        c.create_row(&s.inbox, "a", "First", &none).unwrap();
        c.create_row(
            &s.inbox,
            "b",
            "Pinned",
            &BTreeMap::from([(PINNED.into(), json!(true))]),
        )
        .unwrap();
        c.create_row(
            &s.inbox,
            "c",
            "Later",
            &BTreeMap::from([(INBOX_STATUS.into(), json!("someday"))]),
        )
        .unwrap();
        let r = c.query_database(&s.inbox, None, None).unwrap();
        let titles: Vec<&str> = r.rows.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, ["Pinned", "First"]);
        let o = c.para_overview(&s.hub).unwrap();
        assert_eq!((o.inbox, o.someday), (2, 1));
        assert_eq!(o.inbox_notes[0].title, "Pinned");
    }

    #[test]
    fn promote_moves_the_note_into_projects() {
        let mut c = core();
        let s = c.para_setup(None).unwrap();
        let none = BTreeMap::new();
        c.create_row(&s.areas, "health", "Health", &none).unwrap();
        c.create_row(&s.resources, "r1", "Running plans", &none)
            .unwrap();
        c.create_row(
            &s.inbox,
            "n",
            "Run a marathon",
            &BTreeMap::from([
                (TAGS.into(), json!(["fitness"])),
                (NOTE_TYPE.into(), json!("idea")),
                (s.col("noteAreas").unwrap().into(), json!(["health"])),
                (s.col("noteResources").unwrap().into(), json!(["r1"])),
            ]),
        )
        .unwrap();
        let id = c
            .para_promote(
                "n",
                &Promote {
                    deadline: Some("2027-04-01".into()),
                    outcome: Some("Finish under 4h".into()),
                    next_action: Some("Buy shoes".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(id, "n");
        assert!(c
            .query_database(&s.inbox, None, None)
            .unwrap()
            .rows
            .is_empty());
        let p = c.query_database(&s.projects, None, None).unwrap();
        let row = &p.rows[0];
        assert_eq!(row.title, "Run a marathon");
        assert_eq!(row.values[STATUS], json!("not_started"));
        assert_eq!(row.values[TAGS], json!(["fitness"]));
        assert_eq!(row.values[s.col("projectArea").unwrap()], json!(["health"]));
        assert_eq!(
            row.values[s.col("projectResources").unwrap()],
            json!(["r1"])
        );
        assert!(row.values.get(NOTE_TYPE).is_none());
        let o = c.para_overview(&s.hub).unwrap();
        assert_eq!(o.areas[0].active_projects, 1);
        assert_eq!(o.projects[0].next_action.as_deref(), Some("Buy shoes"));
        assert!(c.para_promote("n", &Promote::default()).is_err());
    }

    #[test]
    fn process_links_and_leaves_the_inbox() {
        let mut c = core();
        let s = c.para_setup(None).unwrap();
        let none = BTreeMap::new();
        c.create_row(&s.areas, "a", "Home", &none).unwrap();
        c.create_row(&s.inbox, "n", "Fix the gutter", &none)
            .unwrap();
        c.para_process(
            "n",
            &Links {
                areas: vec!["a".into()],
                ..Default::default()
            },
        )
        .unwrap();
        assert!(c
            .query_database(&s.inbox, None, None)
            .unwrap()
            .rows
            .is_empty());
        let a = c.query_database(&s.areas, None, None).unwrap();
        assert_eq!(a.rows[0].values[s.col("areaNotes").unwrap()], json!(["n"]));
    }

    #[test]
    fn archive_is_global_and_reversible() {
        let mut c = core();
        let s = c.para_setup(None).unwrap();
        let none = BTreeMap::new();
        c.create_row(&s.projects, "p", "Launch", &none).unwrap();
        c.create_row(&s.resources, "r", "Old wiki", &none).unwrap();
        c.para_archive("p", Some("completed")).unwrap();
        c.para_archive("r", Some("deprecated")).unwrap();
        assert!(c
            .query_database(&s.projects, None, None)
            .unwrap()
            .rows
            .is_empty());
        let o = c.para_overview(&s.hub).unwrap();
        assert_eq!(o.archive.len(), 2);
        let p = o.archive.iter().find(|a| a.id == "p").unwrap();
        assert_eq!(
            (p.kind.as_str(), p.reason.as_deref()),
            ("project", Some("completed"))
        );
        assert!(c.snapshot("p").unwrap().meta.archived);
        let arch = &s.views["projects"]["Archive"];
        let r = c.query_database(&s.projects, Some(arch), None).unwrap();
        assert_eq!(r.rows[0].values[STATUS], json!("completed"));
        c.para_unarchive("p").unwrap();
        assert!(!c.snapshot("p").unwrap().meta.archived);
        assert_eq!(c.para_overview(&s.hub).unwrap().archive.len(), 1);
    }

    #[test]
    fn overdue_reviews() {
        let mut c = core();
        let s = c.para_setup(None).unwrap();
        let row = |c: &mut Core, id: &str, cadence: &str, last: Option<&str>, health: &str| {
            let mut v = BTreeMap::from([
                (CADENCE.to_string(), json!(cadence)),
                (HEALTH.into(), json!(health)),
            ]);
            if let Some(l) = last {
                v.insert(LAST_REVIEWED.into(), json!(l));
            }
            c.create_row(&s.areas, id, id, &v).unwrap();
        };
        row(&mut c, "fresh", "weekly", Some("2026-11-20"), "on_track");
        row(&mut c, "stale", "monthly", Some("2026-10-01"), "on_track");
        row(&mut c, "never", "quarterly", None, "critical");
        let o = c.para_overview_on(&s.hub, "2026-11-23").unwrap();
        let get = |id: &str| o.areas.iter().find(|a| a.id == id).unwrap().clone();
        assert_eq!(
            (get("fresh").overdue, get("fresh").due_in),
            (false, Some(4))
        );
        assert_eq!(
            (get("stale").overdue, get("stale").due_in),
            (true, Some(-23))
        );
        assert!(get("never").overdue);
        assert_eq!(o.areas[0].id, "never"); // critical first
        c.para_reviewed("stale").unwrap();
        assert!(c.para_reviewed(&s.inbox).is_err());
    }
}
