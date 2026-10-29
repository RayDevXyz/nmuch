//! The capability host: a module can do exactly what was approved, in the folders it was given.

use std::collections::BTreeMap;
use std::path::PathBuf;

use bw_core::modules::ModuleManifest;
use bw_core::{Core, Error, PageMeta};
use serde_json::json;

fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("bw-modules-{name}-{}", uuid_like()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn uuid_like() -> String {
    format!("{:?}", std::time::SystemTime::now()).replace(|c: char| !c.is_ascii_alphanumeric(), "")
}

fn manifest(id: &str, caps: &[&str]) -> ModuleManifest {
    ModuleManifest {
        id: id.into(),
        name: id.into(),
        description: String::new(),
        version: "1".into(),
        icon: String::new(),
        namespace: "media".into(),
        capabilities: caps.iter().map(|c| c.to_string()).collect(),
    }
}

fn forbidden<T: std::fmt::Debug>(r: bw_core::Result<T>) -> bool {
    matches!(r, Err(Error::Forbidden(_)))
}

#[test]
fn nothing_works_until_approved_and_only_in_given_folders() {
    let mut core = Core::open_in_memory().unwrap();
    let given = temp_dir("given");
    let other = temp_dir("other");
    std::fs::write(given.join("a.txt"), "hello").unwrap();
    std::fs::create_dir_all(given.join("sub")).unwrap();
    std::fs::write(given.join("sub/b.txt"), "deep").unwrap();
    std::fs::write(given.join(".secret"), "x").unwrap();
    std::fs::write(other.join("c.txt"), "private").unwrap();

    core.install_module(
        &manifest("acme.media", &["fs.pick", "fs.open"]),
        "<html></html>",
        false,
    )
    .unwrap();
    let info = core.module_info("acme.media").unwrap();
    assert!(!info.approved);
    assert_eq!(info.pending.len(), 2);
    assert!(forbidden(
        core.grant_folder("acme.media", given.to_str().unwrap())
    ));

    core.approve_module("acme.media").unwrap();
    let real = core
        .grant_folder("acme.media", given.to_str().unwrap())
        .unwrap();
    let g = core.watch_generation();

    let list = core.fs_list("acme.media", &real, true, 100).unwrap();
    let rels: Vec<_> = list.iter().map(|e| e.rel.as_str()).collect();
    assert_eq!(
        rels,
        ["a.txt", "sub", "sub/b.txt"],
        "hidden files are skipped"
    );
    assert_eq!(
        core.fs_read_text("acme.media", &format!("{real}/sub/b.txt"), 100)
            .unwrap(),
        "deep"
    );

    // Outside the folder, by name, by `..`, or through a link: refused.
    assert!(forbidden(core.fs_list(
        "acme.media",
        other.to_str().unwrap(),
        false,
        10
    )));
    assert!(forbidden(core.fs_read_text(
        "acme.media",
        &format!(
            "{real}/../{}/c.txt",
            other.file_name().unwrap().to_str().unwrap()
        ),
        100
    )));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(other.join("c.txt"), given.join("link.txt")).unwrap();
        assert!(forbidden(core.fs_read_text(
            "acme.media",
            &format!("{real}/link.txt"),
            100
        )));
    }
    assert!(core
        .fs_open_check("acme.media", &format!("{real}/a.txt"))
        .is_ok());

    // Another module gets nothing from this one's folder.
    core.install_module(&manifest("acme.other", &["fs.pick"]), "", false)
        .unwrap();
    core.approve_module("acme.other").unwrap();
    assert!(forbidden(core.fs_list("acme.other", &real, false, 10)));

    assert_eq!(
        core.watch_roots().unwrap(),
        vec![("acme.media".to_string(), PathBuf::from(&real))]
    );

    // Revoked: everything stops, and the watcher hears about it.
    core.revoke_module("acme.media").unwrap();
    assert!(forbidden(core.fs_list("acme.media", &real, false, 10)));
    assert!(core.watch_roots().unwrap().is_empty());
    core.approve_module("acme.media").unwrap();
    assert!(
        forbidden(core.fs_list("acme.media", &real, false, 10)),
        "folders must be picked again"
    );
    assert!(core.watch_generation() >= g);
}

#[test]
fn opening_files_needs_fs_open_and_fixed_paths_need_approval() {
    let mut core = Core::open_in_memory().unwrap();
    let dir = temp_dir("fixed");
    std::fs::write(dir.join("x.txt"), "x").unwrap();
    let cap = format!("fs.read:{}", dir.display());
    core.install_module(&manifest("acme.reader", &[&cap]), "", false)
        .unwrap();
    assert!(forbidden(core.fs_list(
        "acme.reader",
        dir.to_str().unwrap(),
        false,
        10
    )));
    core.approve_module("acme.reader").unwrap();
    assert_eq!(
        core.fs_list("acme.reader", dir.to_str().unwrap(), false, 10)
            .unwrap()
            .len(),
        1
    );
    assert!(forbidden(core.fs_open_check(
        "acme.reader",
        dir.join("x.txt").to_str().unwrap()
    )));
    assert!(
        forbidden(core.grant_folder("acme.reader", dir.to_str().unwrap())),
        "no fs.pick"
    );
}

#[test]
fn modules_reach_their_own_databases_and_namespace() {
    let mut core = Core::open_in_memory().unwrap();
    core.install_module(&manifest("acme.media", &["db.own"]), "", false)
        .unwrap();
    core.approve_module("acme.media").unwrap();
    let mine = core
        .module_create_database(
            "acme.media",
            "mine",
            PageMeta {
                title: "Media".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let theirs = core
        .create_database(
            "theirs",
            PageMeta {
                title: "Private".into(),
                ..Default::default()
            },
        )
        .unwrap();

    core.module_create_row("acme.media", &mine, "r1", "Clip", &BTreeMap::new())
        .unwrap();
    assert_eq!(
        core.module_query("acme.media", &mine, None)
            .unwrap()
            .rows
            .len(),
        1
    );
    assert!(forbidden(core.module_query("acme.media", &theirs, None)));
    assert!(forbidden(core.module_create_row(
        "acme.media",
        &theirs,
        "r2",
        "x",
        &BTreeMap::new()
    )));
    core.create_row(&theirs, "t1", "Secret", &BTreeMap::new())
        .unwrap();
    assert!(forbidden(core.module_set_value(
        "acme.media",
        "t1",
        "title",
        json!("hacked")
    )));

    // Props: only its own namespace.
    core.module_set_props(
        "acme.media",
        "r1",
        &BTreeMap::from([("media.hash".to_string(), json!("abc"))]),
    )
    .unwrap();
    assert_eq!(
        core.module_props("acme.media", "r1").unwrap()["media.hash"],
        json!("abc")
    );
    assert!(forbidden(core.module_set_props(
        "acme.media",
        "r1",
        &BTreeMap::from([("course.progress".to_string(), json!(1))])
    )));
    assert!(forbidden(core.module_set_props(
        "acme.media",
        "r1",
        &BTreeMap::from([("module.owner".to_string(), json!("acme.media"))])
    )));

    // db.read opens up reading, not writing.
    core.install_module(&manifest("acme.viewer", &["db.read"]), "", false)
        .unwrap();
    core.approve_module("acme.viewer").unwrap();
    assert_eq!(
        core.module_query("acme.viewer", &theirs, None)
            .unwrap()
            .rows
            .len(),
        1
    );
    assert!(forbidden(core.module_set_value(
        "acme.viewer",
        "t1",
        "title",
        json!("x")
    )));
}

#[test]
fn manifests_are_checked_and_builtins_are_protected() {
    let mut core = Core::open_in_memory().unwrap();
    assert!(matches!(
        core.install_module(&manifest("acme.x", &["fs.write:/"]), "", false),
        Err(Error::Invalid(_))
    ));
    let mut bad_ns = manifest("acme.y", &[]);
    bad_ns.namespace = "db".into();
    assert!(matches!(
        core.install_module(&bad_ns, "", false),
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        core.install_module(&manifest("Bad Id", &[]), "", false),
        Err(Error::Invalid(_))
    ));

    // The Course module ships with the app, approved, and can't be replaced or removed.
    let course = core.module_info(bw_core::course::MODULE_ID).unwrap();
    assert!(course.builtin && course.approved);
    assert!(core
        .install_module(&manifest(bw_core::course::MODULE_ID, &[]), "", false)
        .is_err());
    assert!(core.remove_module(bw_core::course::MODULE_ID).is_err());

    // An update that asks for more needs approval again.
    core.install_module(&manifest("acme.z", &["db.own"]), "", false)
        .unwrap();
    core.approve_module("acme.z").unwrap();
    core.install_module(&manifest("acme.z", &["db.own", "db.read"]), "", false)
        .unwrap();
    let z = core.module_info("acme.z").unwrap();
    assert!(!z.approved);
    assert_eq!(z.pending, ["Read all your databases"]);
}
