//! Databases, driven by the Course module: courses and lessons linked by a two-way relation,
//! with progress as a rollup.

use std::collections::BTreeMap;

use bw_core::{
    Core, Error, Filter, FilterOp, NewRelation, PageMeta, PageMetaPatch, PropType, Property,
    RollupConfig, RollupFn, SelectOption, Sort, View, ViewKind,
};
use serde_json::{json, Value};

fn prop(id: &str, name: &str, kind: PropType) -> Property {
    Property {
        id: id.into(),
        name: name.into(),
        kind,
        order: String::new(),
        options: vec![],
        relation: None,
        rollup: None,
    }
}

fn rollup(id: &str, name: &str, relation: &str, property: &str, function: RollupFn) -> Property {
    Property {
        rollup: Some(RollupConfig {
            relation: relation.into(),
            property: property.into(),
            function,
        }),
        ..prop(id, name, PropType::Rollup)
    }
}

fn opt(id: &str, name: &str) -> SelectOption {
    SelectOption {
        id: id.into(),
        name: name.into(),
        color: "blue".into(),
    }
}

struct Course {
    courses: String,
    lessons: String,
    /// relation column on Lessons, and its computed pair on Courses
    course_col: String,
    lessons_col: String,
    rust: String,
    lessons_of_rust: Vec<String>,
}

fn values(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

/// The Course module's two databases with a few rows.
fn course_tracker(core: &mut Core) -> Course {
    let courses = core
        .create_database(
            "courses",
            PageMeta {
                title: "Courses".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let lessons = core
        .create_database(
            "lessons",
            PageMeta {
                title: "Lessons".into(),
                ..Default::default()
            },
        )
        .unwrap();

    core.set_property(
        &courses,
        Property {
            options: vec![
                opt("todo", "Not started"),
                opt("doing", "In progress"),
                opt("done", "Done"),
            ],
            ..prop("status", "Status", PropType::Select)
        },
    )
    .unwrap();
    core.set_property(&courses, prop("folder", "Source folder", PropType::File))
        .unwrap();
    core.set_property(&lessons, prop("done", "Done", PropType::Checkbox))
        .unwrap();
    core.set_property(&lessons, prop("order", "Order", PropType::Number))
        .unwrap();
    core.set_property(&lessons, prop("minutes", "Duration", PropType::Number))
        .unwrap();
    core.set_property(&lessons, prop("file", "File", PropType::File))
        .unwrap();

    let (course_col, lessons_col) = core
        .create_relation(
            &lessons,
            &NewRelation {
                name: "Course".into(),
                target_database: courses.clone(),
                two_way: true,
                reverse_name: Some("Lessons".into()),
            },
        )
        .unwrap();
    let lessons_col = lessons_col.unwrap();
    core.set_property(
        &courses,
        rollup(
            "progress",
            "Progress",
            &lessons_col,
            "done",
            RollupFn::PercentChecked,
        ),
    )
    .unwrap();
    core.set_property(
        &courses,
        rollup(
            "total",
            "Total minutes",
            &lessons_col,
            "minutes",
            RollupFn::Sum,
        ),
    )
    .unwrap();
    core.set_property(
        &courses,
        rollup("count", "Lessons", &lessons_col, "title", RollupFn::Count),
    )
    .unwrap();

    let rust = core
        .create_row(
            &courses,
            "c-rust",
            "Rust",
            &values(&[
                ("status", json!("doing")),
                ("folder", json!("C:/Courses/Rust")),
            ]),
        )
        .unwrap();
    core.create_row(
        &courses,
        "c-go",
        "Go",
        &values(&[("status", json!("todo"))]),
    )
    .unwrap();

    let mut ids = vec![];
    for (i, (title, done, mins)) in [
        ("Ownership", true, 30),
        ("Borrowing", true, 25),
        ("Lifetimes", false, 40),
        ("Traits", false, 35),
    ]
    .iter()
    .enumerate()
    {
        let id = format!("l{i}");
        core.create_row(
            &lessons,
            &id,
            title,
            &values(&[
                ("done", json!(done)),
                ("order", json!(i + 1)),
                ("minutes", json!(mins)),
                (&course_col, json!([rust.clone()])),
            ]),
        )
        .unwrap();
        ids.push(id);
    }
    Course {
        courses,
        lessons,
        course_col,
        lessons_col,
        rust,
        lessons_of_rust: ids,
    }
}

fn cell<'a>(r: &'a bw_core::DatabaseResult, row: &str, col: &str) -> Option<&'a Value> {
    r.rows
        .iter()
        .find(|x| x.id == row)
        .and_then(|x| x.values.get(col))
}

#[test]
fn progress_is_a_live_rollup_over_a_two_way_relation() {
    let mut core = Core::open_in_memory().unwrap();
    let c = course_tracker(&mut core);

    let r = core.query_database(&c.courses, None, None).unwrap();
    assert_eq!(r.total, 2);
    assert_eq!(cell(&r, &c.rust, "progress"), Some(&json!(0.5)));
    assert_eq!(cell(&r, &c.rust, "total"), Some(&json!(130)));
    assert_eq!(cell(&r, &c.rust, "count"), Some(&json!(4)));
    // The computed side lists the lessons, in row order, with their titles available.
    assert_eq!(
        cell(&r, &c.rust, &c.lessons_col),
        Some(&json!(c.lessons_of_rust))
    );
    assert_eq!(r.related["l2"].title, "Lifetimes");
    // Go has no lessons: progress is empty (not 0%), count is 0.
    assert_eq!(cell(&r, "c-go", "progress"), None);
    assert_eq!(cell(&r, "c-go", "count"), Some(&json!(0)));

    // Ticking a lesson changes the course's progress.
    core.set_value("l2", "done", json!(true)).unwrap();
    let r = core.query_database(&c.courses, None, None).unwrap();
    assert_eq!(cell(&r, &c.rust, "progress"), Some(&json!(0.75)));

    // Trashed lessons don't count.
    core.update_page(
        "l3",
        &PageMetaPatch {
            trashed_at: Some(Some(1)),
            ..Default::default()
        },
    )
    .unwrap();
    let r = core.query_database(&c.courses, None, None).unwrap();
    assert_eq!(cell(&r, &c.rust, "progress"), Some(&json!(1)));
    assert_eq!(cell(&r, &c.rust, "count"), Some(&json!(3)));
}

#[test]
fn editing_the_computed_side_rewrites_the_stored_links() {
    let mut core = Core::open_in_memory().unwrap();
    let c = course_tracker(&mut core);
    let extra = core
        .create_row(&c.lessons, "l-extra", "Macros", &BTreeMap::new())
        .unwrap();

    // From the course: lessons = first two + the new one.
    let wanted = json!([c.lessons_of_rust[0], c.lessons_of_rust[1], extra]);
    core.set_value(&c.rust, &c.lessons_col, wanted).unwrap();

    let lessons = core.query_database(&c.lessons, None, None).unwrap();
    assert_eq!(
        cell(&lessons, &extra, &c.course_col),
        Some(&json!([c.rust]))
    );
    assert_eq!(
        cell(&lessons, "l2", &c.course_col),
        None,
        "unlinked from the course side"
    );
    let courses = core.query_database(&c.courses, None, None).unwrap();
    let mut got: Vec<String> =
        serde_json::from_value(cell(&courses, &c.rust, &c.lessons_col).unwrap().clone()).unwrap();
    got.sort();
    let mut want = vec![
        c.lessons_of_rust[0].clone(),
        c.lessons_of_rust[1].clone(),
        extra,
    ];
    want.sort();
    assert_eq!(got, want);
}

#[test]
fn views_filter_sort_and_group() {
    let mut core = Core::open_in_memory().unwrap();
    let c = course_tracker(&mut core);

    let open_by_order_desc = View {
        id: "v-open".into(),
        name: "To watch".into(),
        kind: ViewKind::Table,
        order: String::new(),
        filters: vec![Filter {
            property: "done".into(),
            op: FilterOp::Is,
            value: json!(false),
        }],
        sorts: vec![Sort {
            property: "order".into(),
            desc: true,
        }],
        group_by: None,
        hidden: vec!["file".into()],
    };
    core.set_view(&c.lessons, open_by_order_desc).unwrap();
    let r = core
        .query_database(&c.lessons, Some("v-open"), None)
        .unwrap();
    let titles: Vec<&str> = r.rows.iter().map(|x| x.title.as_str()).collect();
    assert_eq!(titles, vec!["Traits", "Lifetimes"]);
    assert_eq!(r.total, 4);

    // Filters on numbers, text and relations.
    let q = |core: &mut Core, f: Filter| {
        let v = View {
            filters: vec![f],
            ..r.view.clone()
        };
        let mut t: Vec<String> = core
            .query_database(&c.lessons, None, Some(v))
            .unwrap()
            .rows
            .into_iter()
            .map(|x| x.title)
            .collect();
        t.sort();
        t
    };
    assert_eq!(
        q(
            &mut core,
            Filter {
                property: "minutes".into(),
                op: FilterOp::Gt,
                value: json!(30)
            }
        ),
        vec!["Lifetimes", "Traits"]
    );
    assert_eq!(
        q(
            &mut core,
            Filter {
                property: "title".into(),
                op: FilterOp::Contains,
                value: json!("own")
            }
        ),
        vec!["Ownership"]
    );
    assert_eq!(
        q(
            &mut core,
            Filter {
                property: c.course_col.clone(),
                op: FilterOp::Is,
                value: json!(c.rust)
            }
        )
        .len(),
        4
    );
    assert_eq!(
        q(
            &mut core,
            Filter {
                property: "file".into(),
                op: FilterOp::Empty,
                value: Value::Null
            }
        )
        .len(),
        4
    );

    // A board groups courses by status, in option order, with a "No Status" column first.
    let board = View {
        id: "v-board".into(),
        name: "Board".into(),
        kind: ViewKind::Board,
        order: String::new(),
        filters: vec![],
        sorts: vec![],
        group_by: Some("status".into()),
        hidden: vec![],
    };
    core.set_view(&c.courses, board).unwrap();
    core.create_row(&c.courses, "c-none", "Unsorted", &BTreeMap::new())
        .unwrap();
    let r = core
        .query_database(&c.courses, Some("v-board"), None)
        .unwrap();
    let groups: Vec<(&str, Vec<String>)> = r
        .groups
        .iter()
        .map(|g| (g.name.as_str(), g.rows.clone()))
        .collect();
    assert_eq!(
        groups,
        vec![
            ("No Status", vec!["c-none".to_string()]),
            ("Not started", vec!["c-go".to_string()]),
            ("In progress", vec![c.rust.clone()]),
            ("Done", vec![]),
        ]
    );
}

#[test]
fn values_are_checked_and_columns_guarded() {
    let mut core = Core::open_in_memory().unwrap();
    let c = course_tracker(&mut core);
    let invalid = |r: bw_core::Result<()>| assert!(matches!(r, Err(Error::Invalid(_))), "{r:?}");

    invalid(core.set_value("l0", "order", json!("lots")));
    invalid(core.set_value("l0", "done", json!("yes")));
    invalid(core.set_value(&c.rust, "progress", json!(1)));
    invalid(core.set_value("l0", "nope", json!(1)));
    core.set_value("l0", "order", json!(" 7 ")).unwrap(); // numeric text is accepted
    core.set_value("l0", "title", json!("Ownership & moves"))
        .unwrap();
    let r = core.query_database(&c.lessons, None, None).unwrap();
    assert_eq!(cell(&r, "l0", "order"), Some(&json!(7)));
    assert_eq!(cell(&r, "l0", "title"), Some(&json!("Ownership & moves")));
    core.set_value("l0", "done", json!(false)).unwrap();
    assert_eq!(
        cell(
            &core.query_database(&c.lessons, None, None).unwrap(),
            "l0",
            "done"
        ),
        None,
        "unchecked = empty"
    );

    invalid(core.set_property(&c.lessons, prop("title", "Name", PropType::Text)));
    invalid(core.set_property(&c.lessons, prop("x", "Second title", PropType::Title)));
    invalid(core.set_property(&c.lessons, prop("rel", "Sneaky", PropType::Relation)));
    invalid(core.set_property(
        &c.lessons,
        rollup("r", "Bad", "done", "title", RollupFn::Count),
    ));
    invalid(core.remove_property(&c.lessons, "title"));
    invalid(
        core.create_row("l0", "x", "Not a database", &BTreeMap::new())
            .map(|_| ()),
    );

    // Removing the stored side of the relation removes its pair and the rollups over it.
    core.remove_property(&c.lessons, &c.course_col).unwrap();
    let def = core.database_def(&c.courses).unwrap();
    assert!(def.property(&c.lessons_col).is_none());
    assert!(def.property("progress").is_none() && def.property("total").is_none());
    assert!(def.property("status").is_some());
}

#[test]
fn rows_are_pages_and_the_index_rebuilds() {
    let dir = std::env::temp_dir().join(format!("bw-db-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("w.db");
    let _ = std::fs::remove_file(&path);
    let before = {
        let mut core = Core::open(&path).unwrap();
        let c = course_tracker(&mut core);
        let pages = core.list_pages().unwrap();
        let row = pages.iter().find(|p| p.id == "l0").unwrap();
        assert_eq!(row.database_id.as_deref(), Some(c.lessons.as_str()));
        assert_eq!(row.parent_id.as_deref(), Some(c.lessons.as_str()));
        assert_eq!(
            pages.iter().find(|p| p.id == c.courses).unwrap().kind,
            "database"
        );

        let r = core.query_database(&c.courses, None, None).unwrap();
        let dump = core.index_dump().unwrap();
        core.rebuild_index().unwrap();
        assert_eq!(core.index_dump().unwrap(), dump);
        assert_eq!(core.query_database(&c.courses, None, None).unwrap(), r);
        r
    };

    // An index written by an older version is rebuilt from the log on open.
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute_batch("UPDATE index_version SET v = 2; DELETE FROM page_meta;")
        .unwrap();
    drop(raw);
    let mut core = Core::open(&path).unwrap();
    assert_eq!(core.query_database("courses", None, None).unwrap(), before);
}
