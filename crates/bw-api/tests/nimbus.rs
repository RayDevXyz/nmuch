mod common;

use bw_api::{dispatch, Context};
use bw_core::Core;
use common::nimbus_sample;
use serde_json::json;

#[test]
fn reads_an_old_nimbus_database_without_changing_it() {
    let dir = std::env::temp_dir().join(format!("bw-api-nimbus-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("nimbus.db");
    nimbus_sample::write(&path);
    let before = std::fs::read(&path).unwrap();

    let mut core = Core::open_in_memory().unwrap();
    let ctx = Context {
        nimbus_db: Some(path.clone()),
        ..Default::default()
    };
    let p = path.display().to_string();

    assert_eq!(
        dispatch(&mut core, &ctx, "nimbusDefaultPath", json!({})).unwrap(),
        json!(p)
    );
    let missing = Context {
        nimbus_db: Some(dir.join("nope.db")),
        ..Default::default()
    };
    assert_eq!(
        dispatch(&mut core, &missing, "nimbusDefaultPath", json!({})).unwrap(),
        json!(null)
    );

    let pages = dispatch(&mut core, &ctx, "nimbusPages", json!({ "path": p })).unwrap();
    let pages = pages.as_array().unwrap();
    assert_eq!(pages.len(), 4);
    let week = pages.iter().find(|x| x["id"] == "n-week1").unwrap();
    assert_eq!(week["parentId"], "n-course");
    assert_eq!(week["archived"], true);
    assert_eq!(
        pages.iter().find(|x| x["id"] == "n-old").unwrap()["trashedAt"],
        json!(nimbus_sample::T0 + 40 * nimbus_sample::DAY)
    );

    let blocks = dispatch(
        &mut core,
        &ctx,
        "nimbusBlocks",
        json!({ "path": p, "pageId": "n-journal" }),
    )
    .unwrap();
    let blocks = blocks.as_array().unwrap();
    assert_eq!(blocks.len(), 17);
    assert_eq!(blocks[0]["type"], "h1");
    assert_eq!(blocks[2]["props"]["icon"], "💧");
    assert_eq!(blocks[4]["props"]["indent"], 1);

    // Not a Nimbus file / no file.
    std::fs::write(dir.join("empty.db"), b"").unwrap();
    let err = dispatch(
        &mut core,
        &ctx,
        "nimbusPages",
        json!({ "path": dir.join("empty.db").display().to_string() }),
    )
    .unwrap_err();
    assert!(err.contains("not a Nimbus database"), "{err}");
    assert!(dispatch(
        &mut core,
        &ctx,
        "nimbusPages",
        json!({ "path": "/no/such/file.db" })
    )
    .unwrap_err()
    .contains("no file"));

    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "the old database is never written"
    );
}
