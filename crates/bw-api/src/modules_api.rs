//! Module and Course commands (see `bw_core::modules` and `bw_core::course`).
//!
//! `moduleCall` is what a sandboxed module's `bw` client reaches: the host fills in `moduleId`
//! from the module it started, never from the module itself, and the core checks every call
//! against that module's approved capabilities and folders.

use std::collections::BTreeMap;

use bw_core::course::MODULE_ID as COURSE;
use bw_core::modules::ModuleManifest;
use bw_core::{Core, PageMeta, Property, View};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{args, ok, Context};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Install {
    manifest: ModuleManifest,
    #[serde(default)]
    code: String,
}

#[derive(Deserialize)]
struct Id {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Folder {
    module_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Call {
    module_id: String,
    op: String,
    #[serde(default)]
    args: Value,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Op {
    path: String,
    recursive: bool,
    max: Option<usize>,
    database_id: String,
    row_id: String,
    page_id: String,
    property_id: String,
    title: String,
    icon: String,
    parent_id: Option<String>,
    value: Value,
    values: BTreeMap<String, Value>,
    props: BTreeMap<String, Value>,
    property: Option<Property>,
    view: Option<View>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseArgs {
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    courses_db: String,
    #[serde(default)]
    folder: String,
    #[serde(default)]
    id: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct DndArgs {
    id: String,
    url: String,
    title: String,
    name: String,
    campaign: Option<String>,
    template: String,
    arc: String,
    sheet: Value,
}

/// Open a file in its default app. Failing to (no desktop, say) isn't an error for the caller:
/// the bookkeeping already happened, and the reply says whether the file opened.
fn open_path(ctx: &Context, path: &std::path::Path) -> Value {
    let opened = ctx.open_files && open::that_detached(path).is_ok();
    json!({ "path": path.to_string_lossy(), "opened": opened })
}

pub(crate) fn dispatch(
    core: &mut Core,
    ctx: &Context,
    command: &str,
    a: Value,
) -> Option<Result<Value, String>> {
    let e = |err: bw_core::Error| err.to_string();
    Some((|| match command {
        // ---- registry and approvals (the user acting in the app)
        "listModules" => ok(core.list_modules().map_err(e)?),
        "moduleInfo" => {
            let Id { id } = args(a)?;
            ok(core.module_info(&id).map_err(e)?)
        }
        "installModule" => {
            let Install { manifest, code } = args(a)?;
            core.install_module(&manifest, &code, false).map_err(e)?;
            ok(core.module_info(&manifest.id).map_err(e)?)
        }
        "removeModule" => {
            let Id { id } = args(a)?;
            ok(core.remove_module(&id).map_err(e)?)
        }
        "approveModule" => {
            let Id { id } = args(a)?;
            ok(core.approve_module(&id).map_err(e)?)
        }
        "revokeModule" => {
            let Id { id } = args(a)?;
            ok(core.revoke_module(&id).map_err(e)?)
        }
        // The user chose this folder for the module in a folder dialog.
        "grantFolder" => {
            let Folder { module_id, path } = args(a)?;
            ok(core.grant_folder(&module_id, &path).map_err(e)?)
        }
        "revokeFolder" => {
            let Folder { module_id, path } = args(a)?;
            ok(core.revoke_folder(&module_id, &path).map_err(e)?)
        }

        // ---- the Course module
        "courseSetup" => {
            let c: CourseArgs = args(a)?;
            ok(core.course_setup(c.parent_id.as_deref()).map_err(e)?)
        }
        "courseTrackers" => ok(core.course_trackers().map_err(e)?),
        "courseTracker" => {
            let c: CourseArgs = args(a)?;
            ok(core.course_tracker(&c.id).map_err(e)?)
        }
        "courseImport" => {
            let c: CourseArgs = args(a)?;
            ok(core.course_import(&c.courses_db, &c.folder).map_err(e)?)
        }
        "courseSync" => {
            let c: CourseArgs = args(a)?;
            ok(core.course_sync(&c.id).map_err(e)?)
        }
        "courseOpenLesson" => {
            let c: CourseArgs = args(a)?;
            let path = core.course_open_lesson(&c.id).map_err(e)?;
            Ok(open_path(ctx, &path))
        }

        // ---- the D&D module (5e content itself is fetched by `fivee.rs`)
        "dndSource" => ok(core.dnd_source().map_err(e)?),
        "dndSetSource" => {
            let d: DndArgs = args(a)?;
            ok(core.dnd_set_source(&d.url).map_err(e)?)
        }
        "dndWorkspace" => ok(core.dnd_workspace().map_err(e)?),
        "dndCampaigns" => ok(core.dnd_campaigns().map_err(e)?),
        "dndCampaign" => {
            let d: DndArgs = args(a)?;
            ok(core.dnd_campaign(&d.id).map_err(e)?)
        }
        "dndCreateCampaign" => {
            let d: DndArgs = args(a)?;
            ok(core.dnd_create_campaign(&d.title).map_err(e)?)
        }
        "dndAddBeats" => {
            let d: DndArgs = args(a)?;
            ok(core.dnd_add_beats(&d.id, &d.template, &d.arc).map_err(e)?)
        }
        "dndCreateCharacter" => {
            let d: DndArgs = args(a)?;
            let sheet = if d.sheet.is_null() {
                json!({})
            } else {
                d.sheet
            };
            ok(core
                .dnd_create_character(&d.name, sheet, d.campaign.as_deref())
                .map_err(e)?)
        }
        "dndSheet" => {
            let d: DndArgs = args(a)?;
            ok(core.dnd_sheet(&d.id).map_err(e)?)
        }
        "dndSetSheet" => {
            let d: DndArgs = args(a)?;
            ok(core.dnd_set_sheet(&d.id, d.sheet).map_err(e)?)
        }
        "dndThemedRoots" => ok(core.dnd_themed_roots().map_err(e)?),
        "dndRoles" => ok(core.dnd_roles().map_err(e)?),
        "dndImportAzgaar" => {
            #[derive(Deserialize)]
            struct A {
                id: String,
                world: bw_core::azgaar::AzgaarWorld,
            }
            let A { id, world } = args(a)?;
            ok(core.dnd_import_azgaar(&id, &world).map_err(e)?)
        }

        // ---- calls from sandboxed modules
        "moduleCall" => {
            let Call {
                module_id,
                op,
                args: inner,
            } = args(a)?;
            if module_id == COURSE {
                return Err("the Course module has no sandboxed code".into());
            }
            let o: Op = if inner.is_null() {
                Op::default()
            } else {
                args(inner)?
            };
            let m = module_id.as_str();
            match op.as_str() {
                "fs.roots" => ok(core.readable_roots(m).map_err(e)?),
                "fs.list" => ok(core
                    .fs_list(m, &o.path, o.recursive, o.max.unwrap_or(2000).min(20_000))
                    .map_err(e)?),
                "fs.readText" => ok(core
                    .fs_read_text(m, &o.path, o.max.unwrap_or(1 << 20).min(8 << 20))
                    .map_err(e)?),
                "fs.open" => {
                    let p = core.fs_open_check(m, &o.path).map_err(e)?;
                    Ok(open_path(ctx, &p))
                }
                "db.create" => {
                    let meta = PageMeta {
                        title: o.title,
                        icon: o.icon,
                        parent_id: o.parent_id,
                        ..Default::default()
                    };
                    ok(core
                        .module_create_database(m, &bw_core::schema::new_id(), meta)
                        .map_err(e)?)
                }
                "db.setProperty" => {
                    let p = o.property.ok_or("property is required")?;
                    ok(core.module_set_property(m, &o.database_id, p).map_err(e)?)
                }
                "db.query" => ok(core.module_query(m, &o.database_id, o.view).map_err(e)?),
                "db.createRow" => {
                    let id = bw_core::schema::new_id();
                    ok(core
                        .module_create_row(m, &o.database_id, &id, &o.title, &o.values)
                        .map_err(e)?)
                }
                "db.setValue" => ok(core
                    .module_set_value(m, &o.row_id, &o.property_id, o.value)
                    .map_err(e)?),
                "props.get" => ok(core.module_props(m, &o.page_id).map_err(e)?),
                "props.set" => ok(core.module_set_props(m, &o.page_id, &o.props).map_err(e)?),
                other => Err(format!("unknown module call {other}")),
            }
        }
        _ => Err(String::new()),
    })())
    .filter(|r| !matches!(r, Err(s) if s.is_empty()))
}
