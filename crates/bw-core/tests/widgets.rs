//! The widget data API: a widget reaches exactly what its instance is bound to.

use std::collections::BTreeMap;

use bw_core::{
    Access, Core, Error, FieldSpec, Filter, FilterOp, Manifest, NewBlock, PageMeta, PropType,
    Property, SlotSpec, WidgetQuery,
};
use serde_json::{json, Value};

fn manifest(id: &str, access: Access, fields: &[(&str, &[PropType], bool)]) -> Manifest {
    Manifest {
        id: id.into(),
        name: id.into(),
        description: String::new(),
        version: "1".into(),
        icon: String::new(),
        slots: BTreeMap::from([(
            "items".to_string(),
            SlotSpec {
                access,
                label: "Items".into(),
                description: String::new(),
                fields: fields
                    .iter()
                    .map(|(k, t, opt)| {
                        (
                            k.to_string(),
                            FieldSpec {
                                label: k.to_string(),
                                types: t.to_vec(),
                                optional: *opt,
                            },
                        )
                    })
                    .collect(),
            },
        )]),
        height: None,
    }
}

fn prop(id: &str, kind: PropType) -> Property {
    Property {
        id: id.into(),
        name: id.into(),
        kind,
        order: String::new(),
        options: vec![],
        relation: None,
        rollup: None,
    }
}

struct World {
    page: String,
    progress: String,
    quick_add: String,
    lessons: String,
    other_row: String,
}

/// Lessons (done, minutes, secret notes) and an unrelated database, plus a page with two
/// widgets bound to Lessons: a read-only progress widget and a write-enabled quick add.
fn world(core: &mut Core) -> World {
    let lessons = core
        .create_database(
            "lessons",
            PageMeta {
                title: "Lessons".into(),
                ..Default::default()
            },
        )
        .unwrap();
    core.set_property(&lessons, prop("done", PropType::Checkbox))
        .unwrap();
    core.set_property(&lessons, prop("minutes", PropType::Number))
        .unwrap();
    core.set_property(&lessons, prop("secret", PropType::Text))
        .unwrap();
    for (i, done) in [true, false, false, true].iter().enumerate() {
        let v = BTreeMap::from([
            ("done".to_string(), json!(done)),
            ("secret".to_string(), json!("private notes")),
        ]);
        core.create_row(&lessons, &format!("l{i}"), &format!("Lesson {i}"), &v)
            .unwrap();
    }
    let other = core
        .create_database(
            "other",
            PageMeta {
                title: "Other".into(),
                ..Default::default()
            },
        )
        .unwrap();
    core.create_row(&other, "o1", "Not yours", &BTreeMap::new())
        .unwrap();

    core.install_widget(
        &manifest(
            "progress",
            Access::Read,
            &[("done", &[PropType::Checkbox], false)],
        ),
        "<p>progress</p>",
        true,
    )
    .unwrap();
    core.install_widget(
        &manifest(
            "quick-add",
            Access::Write,
            &[
                ("done", &[PropType::Checkbox], true),
                ("minutes", &[PropType::Number], true),
            ],
        ),
        "<p>add</p>",
        false,
    )
    .unwrap();

    let page = core
        .create_page(PageMeta {
            title: "Dashboard".into(),
            ..Default::default()
        })
        .unwrap();
    let bind = json!({ "items": { "databaseId": lessons, "fields": { "done": "done", "minutes": "minutes" } } });
    let (progress, quick_add) = core
        .transact(&page, |tx| {
            let n = tx.first_note()?;
            let a = tx.append(&n, NewBlock::widget("progress", bind.clone(), json!({})))?;
            let b = tx.append(
                &n,
                NewBlock::widget("quick-add", bind.clone(), json!({ "label": "Add" })),
            )?;
            Ok((a, b))
        })
        .unwrap();
    World {
        page,
        progress,
        quick_add,
        lessons,
        other_row: "o1".into(),
    }
}

fn forbidden<T: std::fmt::Debug>(r: bw_core::Result<T>) {
    assert!(
        matches!(r, Err(Error::Forbidden(_))),
        "expected Forbidden, got {r:?}"
    );
}

#[test]
fn a_widget_sees_only_its_bound_fields() {
    let mut core = Core::open_in_memory().unwrap();
    let w = world(&mut core);
    let r = core
        .widget_query(&w.page, &w.progress, "items", &WidgetQuery::default())
        .unwrap();
    assert_eq!(r.total, 4);
    assert_eq!(r.database.title, "Lessons");
    let keys: Vec<&str> = r.fields.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys, vec!["done", "title"]);
    let done = r
        .rows
        .iter()
        .filter(|x| x.values.get("done") == Some(&json!(true)))
        .count();
    assert_eq!(done, 2);
    // The secret column is never in the result, not even under its own id.
    let all = serde_json::to_string(&r).unwrap();
    assert!(
        !all.contains("private notes") && !all.contains("secret"),
        "{all}"
    );

    // Filters and sorts use field keys; other columns can't be named.
    let q = WidgetQuery {
        filters: vec![Filter {
            property: "done".into(),
            op: FilterOp::Is,
            value: json!(true),
        }],
        limit: Some(1),
        ..Default::default()
    };
    let r = core
        .widget_query(&w.page, &w.progress, "items", &q)
        .unwrap();
    assert_eq!((r.rows.len(), r.total), (1, 2));
    let q = WidgetQuery {
        filters: vec![Filter {
            property: "secret".into(),
            op: FilterOp::NotEmpty,
            value: Value::Null,
        }],
        ..Default::default()
    };
    forbidden(core.widget_query(&w.page, &w.progress, "items", &q));
}

#[test]
fn writes_need_a_write_slot_bound_fields_and_rows_of_the_bound_database() {
    let mut core = Core::open_in_memory().unwrap();
    let w = world(&mut core);
    let patch = |pairs: &[(&str, Value)]| {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect::<BTreeMap<_, _>>()
    };

    forbidden(core.widget_mutate(
        &w.page,
        &w.progress,
        "items",
        "l1",
        &patch(&[("done", json!(true))]),
    ));
    forbidden(core.widget_mutate(
        &w.page,
        &w.quick_add,
        "items",
        "l1",
        &patch(&[("secret", json!("x"))]),
    ));
    forbidden(core.widget_mutate(
        &w.page,
        &w.quick_add,
        "items",
        &w.other_row,
        &patch(&[("title", json!("mine now"))]),
    ));
    forbidden(core.widget_mutate(
        &w.page,
        &w.quick_add,
        "nope",
        "l1",
        &patch(&[("done", json!(true))]),
    ));
    forbidden(core.widget_mutate(
        &w.page,
        "not-a-widget",
        "items",
        "l1",
        &patch(&[("done", json!(true))]),
    ));
    forbidden(core.widget_create_row(
        &w.page,
        &w.progress,
        "items",
        &patch(&[("title", json!("x"))]),
    ));

    core.widget_mutate(
        &w.page,
        &w.quick_add,
        "items",
        "l1",
        &patch(&[("done", json!(true)), ("title", json!("Renamed"))]),
    )
    .unwrap();
    let id = core
        .widget_create_row(
            &w.page,
            &w.quick_add,
            "items",
            &patch(&[("title", json!("From a widget")), ("minutes", json!(15))]),
        )
        .unwrap();

    // The read-only widget sees both changes: widget A writes, widget B reads.
    let r = core
        .widget_query(&w.page, &w.progress, "items", &WidgetQuery::default())
        .unwrap();
    assert_eq!(r.total, 5);
    assert_eq!(
        r.rows
            .iter()
            .filter(|x| x.values.get("done") == Some(&json!(true)))
            .count(),
        3
    );
    assert!(r
        .rows
        .iter()
        .any(|x| x.id == id && x.title == "From a widget"));
    assert!(r.rows.iter().any(|x| x.id == "l1" && x.title == "Renamed"));
    // Values still go through the database's checks.
    assert!(matches!(
        core.widget_mutate(
            &w.page,
            &w.quick_add,
            "items",
            "l1",
            &patch(&[("minutes", json!("lots"))])
        ),
        Err(Error::Invalid(_))
    ));
}

#[test]
fn bindings_are_checked_against_the_manifest() {
    let mut core = Core::open_in_memory().unwrap();
    let w = world(&mut core);
    // Bind the checkbox field to a number column, and leave a required field unbound.
    let (wrong, unbound, empty) = core
        .transact(&w.page, |tx| {
            let n = tx.first_note()?;
            let a = tx.append(&n, NewBlock::widget("progress", json!({ "items": { "databaseId": w.lessons, "fields": { "done": "minutes" } } }), json!({})))?;
            let b = tx.append(&n, NewBlock::widget("progress", json!({ "items": { "databaseId": w.lessons, "fields": {} } }), json!({})))?;
            let c = tx.append(&n, NewBlock::widget("progress", json!({}), json!({})))?;
            Ok((a, b, c))
        })
        .unwrap();
    for block in [&wrong, &unbound, &empty] {
        forbidden(core.widget_query(&w.page, block, "items", &WidgetQuery::default()));
    }
    // A widget block on another page can't be used from this one.
    let elsewhere = core.create_page(PageMeta::default()).unwrap();
    forbidden(core.widget_query(&elsewhere, &w.progress, "items", &WidgetQuery::default()));
    // Uninstalled widgets stop working.
    core.remove_widget("progress").unwrap();
    assert!(core
        .widget_query(&w.page, &w.progress, "items", &WidgetQuery::default())
        .is_err());
}

#[test]
fn definitions_are_validated_and_listed_without_code() {
    let mut core = Core::open_in_memory().unwrap();
    let mut m = manifest(
        "good-one",
        Access::Read,
        &[("done", &[PropType::Checkbox], false)],
    );
    core.install_widget(&m, "<html></html>", false).unwrap();
    let list = core.list_widgets().unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].html.is_empty());
    assert_eq!(core.widget_def("good-one").unwrap().html, "<html></html>");

    for bad_id in ["", "A", "has space", "../x", "UPPER"] {
        m.id = bad_id.into();
        assert!(
            matches!(core.install_widget(&m, "", false), Err(Error::Invalid(_))),
            "{bad_id}"
        );
    }
    let bad_field = manifest(
        "ok-id",
        Access::Read,
        &[("title", &[PropType::Text], false)],
    );
    assert!(core.install_widget(&bad_field, "", false).is_err());
    let no_types = manifest("ok-id", Access::Read, &[("x", &[], false)]);
    assert!(core.install_widget(&no_types, "", false).is_err());
    let huge = "x".repeat(3 * 1024 * 1024);
    assert!(core
        .install_widget(&manifest("ok-id", Access::Read, &[]), &huge, false)
        .is_err());
}

#[test]
fn widget_blocks_link_to_their_databases() {
    let mut core = Core::open_in_memory().unwrap();
    let w = world(&mut core);
    let back = core.backlinks(&w.lessons).unwrap();
    assert_eq!(
        back.iter().filter(|b| b.page_id == w.page).count(),
        2,
        "{back:?}"
    );
}
