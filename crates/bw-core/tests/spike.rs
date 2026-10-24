//! The spike's acceptance tests. Each test proves one claim from the architecture doc.

use bw_core::{flavour, Core, Error, Event, Origin};
use serde_json::json;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, Map, MapRef, Out, ReadTxn, Text, Transact, Update};

/// A small page: heading, two paragraphs (one nested), a database with two rows.
fn sample_page(core: &mut Core) -> (String, Vec<String>) {
    let page = core.create_page("Rust course").unwrap();
    let ids = core
        .transact(&page, |tx| {
            let h = tx.append(&page, flavour::HEADING, "Week 1")?;
            let p1 = tx.append(&page, flavour::PARAGRAPH, "Ownership and borrowing")?;
            let p2 = tx.append(
                &p1,
                flavour::PARAGRAPH,
                &format!("See (({h})) and [[{page}]]"),
            )?;
            let db = tx.append(&page, flavour::DATABASE, "Lessons")?;
            let r1 = tx.append(&db, flavour::PAGE, "Lesson 1")?;
            let r2 = tx.append(&db, flavour::PAGE, "Lesson 2")?;
            tx.set_prop(&page, "course.source_path", json!("~/Courses/rust"))?;
            tx.set_prop(&r1, "course.progress", json!(0.5))?;
            tx.set_prop(&r2, "course.progress", json!(1))?;
            tx.set_prop(&r2, "course.done", json!(true))?;
            Ok(vec![h, p1, p2, db, r1, r2])
        })
        .unwrap();
    (page, ids)
}

#[test]
fn block_tree_round_trips_through_snapshot() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    let [h, p1, p2, db, r1, r2] = ids.try_into().unwrap();

    let snap = core.snapshot(&page).unwrap();
    let order: Vec<_> = snap.blocks.iter().map(|b| b.id.clone()).collect();
    assert_eq!(
        order,
        vec![
            page.clone(),
            h.clone(),
            p1.clone(),
            p2.clone(),
            db.clone(),
            r1.clone(),
            r2.clone()
        ]
    );

    let root = snap.root();
    assert_eq!(root.flavour, flavour::PAGE);
    assert_eq!(root.text, "Rust course");
    assert_eq!(root.parent, None);

    let nested = snap.get(&p2).unwrap();
    assert_eq!(nested.parent.as_deref(), Some(p1.as_str()));
    assert_eq!(nested.depth, 2);
    assert_eq!(snap.get(&r2).unwrap().props["course.progress"], json!(1));
    assert_eq!(snap.get(&r1).unwrap().props["course.progress"], json!(0.5));
}

#[test]
fn every_write_is_logged_and_indexed_atomically() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    let (h, db, r2) = (&ids[0], &ids[3], &ids[5]);

    // create_page + one transact = two log rows.
    assert_eq!(core.log_len(&page).unwrap(), 2);

    // The index answers queries without loading any Y.Doc.
    assert_eq!(
        core.db_rows(db).unwrap(),
        vec![ids[4].clone(), ids[5].clone()]
    );
    assert_eq!(core.backlinks(h).unwrap(), vec![ids[2].clone()]);
    assert_eq!(core.backlinks(&page).unwrap(), vec![ids[2].clone()]);
    assert_eq!(
        core.blocks_with_prop("course.done", &json!(true)).unwrap(),
        vec![r2.clone()]
    );

    // An empty transaction writes nothing.
    core.transact(&page, |_| Ok(())).unwrap();
    assert_eq!(core.log_len(&page).unwrap(), 2);
}

#[test]
fn edits_moves_and_deletes_are_reflected() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    let [h, p1, p2, db, r1, r2] = ids.try_into().unwrap();

    core.transact(&page, |tx| {
        tx.insert_text(&h, 4, " One")?; // "Week One 1"
        tx.set_text(&h, "Week 1: Basics")?;
        tx.move_block(&p2, &page, Some(0))?; // un-nest p2 and put it first
        tx.move_block(&r2, &db, Some(0))?; // reorder rows
        tx.remove_prop(&r1, "course.progress")?;
        tx.delete_block(&p1)?;
        Ok(())
    })
    .unwrap();

    let snap = core.snapshot(&page).unwrap();
    let order: Vec<_> = snap.blocks.iter().map(|b| b.id.as_str()).collect();
    assert_eq!(order, vec![page.as_str(), &p2, &h, &db, &r2, &r1]);
    assert_eq!(snap.get(&h).unwrap().text, "Week 1: Basics");
    assert!(snap.get(&r1).unwrap().props.is_empty());
    assert_eq!(core.db_rows(&db).unwrap(), vec![r2.clone(), r1.clone()]);
    assert!(core
        .blocks_with_prop("course.progress", &json!(0.5))
        .unwrap()
        .is_empty());

    // Invalid operations are rejected.
    let err = core
        .transact(&page, |tx| tx.move_block(&db, &r1, None))
        .unwrap_err();
    assert!(matches!(err, Error::Invalid(_)));
    let err = core
        .transact(&page, |tx| tx.delete_block(&page))
        .unwrap_err();
    assert!(matches!(err, Error::Invalid(_)));
    let err = core
        .transact(&page, |tx| tx.set_text("nope", "x"))
        .unwrap_err();
    assert!(matches!(err, Error::BlockNotFound(_)));
}

#[test]
fn failed_transaction_persists_nothing() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    let before = core.snapshot(&page).unwrap();
    let log_before = core.log_len(&page).unwrap();

    // The first op succeeds in memory, then the closure fails.
    let res = core.transact(&page, |tx| {
        tx.set_text(&ids[0], "this must not survive")?;
        tx.delete_block("missing-block")
    });
    assert!(res.is_err());

    assert_eq!(core.log_len(&page).unwrap(), log_before);
    assert_eq!(
        core.snapshot(&page).unwrap(),
        before,
        "doc is replayed from the log"
    );
}

#[test]
fn persistence_survives_reopen() {
    let dir = tempdir();
    let path = dir.join("workspace.db");
    let (page, snap) = {
        let mut core = Core::open(&path).unwrap();
        let (page, _) = sample_page(&mut core);
        let snap = core.snapshot(&page).unwrap();
        (page, snap)
    };
    let mut core = Core::open(&path).unwrap();
    assert_eq!(core.page_ids().unwrap(), vec![page.clone()]);
    assert_eq!(core.snapshot(&page).unwrap(), snap);
}

#[test]
fn rebuilt_index_equals_incremental_index() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    let (page2, _) = sample_page(&mut core);
    core.transact(&page, |tx| {
        tx.delete_block(&ids[1])?;
        tx.append(&page, flavour::TODO, &format!("Review (({}))", ids[0]))?;
        Ok(())
    })
    .unwrap();
    core.transact(&page2, |tx| {
        tx.set_prop(&page2, "course.archived", json!(true))
    })
    .unwrap();

    let incremental = core.index_dump().unwrap();
    let report = core.rebuild_index().unwrap();
    assert_eq!(report.pages, 2);
    assert_eq!(report.blocks, incremental.blocks.len());
    assert_eq!(core.index_dump().unwrap(), incremental);
}

#[test]
fn deleted_index_is_rebuilt_on_open() {
    let dir = tempdir();
    let path = dir.join("workspace.db");
    let expected = {
        let mut core = Core::open(&path).unwrap();
        sample_page(&mut core);
        sample_page(&mut core);
        core.index_dump().unwrap()
    };

    // Simulate a lost/corrupt index: drop every projected table behind the core's back.
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute_batch("DROP TABLE blocks; DROP TABLE props; DROP TABLE refs; DROP TABLE db_rows; DROP TABLE index_state;")
        .unwrap();
    drop(raw);

    let core = Core::open(&path).unwrap();
    assert_eq!(core.index_dump().unwrap(), expected);
}

#[test]
fn compaction_keeps_the_document_identical() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    for i in 0..20 {
        core.transact(&page, |tx| tx.set_text(&ids[0], &format!("Week {i}")))
            .unwrap();
    }
    let snap = core.snapshot(&page).unwrap();
    let index = core.index_dump().unwrap();
    assert_eq!(core.log_len(&page).unwrap(), 22);

    assert_eq!(core.compact(&page).unwrap(), 22);
    assert_eq!(core.log_len(&page).unwrap(), 1);

    core.evict_all();
    assert_eq!(core.snapshot(&page).unwrap(), snap);
    core.rebuild_index().unwrap();
    assert_eq!(core.index_dump().unwrap(), index);
}

/// The editor flow: the frontend keeps its own Y.Doc, syncs it from the core, edits it,
/// and sends the resulting update back. The core is still the only thing writing to disk.
#[test]
fn editor_updates_flow_through_the_core() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    let events = core.subscribe();

    // 1. Editor opens the page: gets the full state.
    let editor = Doc::new();
    let full = core.encode_update_for(&page, None).unwrap();
    editor
        .transact_mut()
        .apply_update(Update::decode_v1(&full).unwrap())
        .unwrap();

    // 2. User types in the heading, in the editor's own doc.
    let sv = editor.transact().state_vector();
    {
        let blocks: MapRef = editor.get_or_insert_map("blocks");
        let mut txn = editor.transact_mut();
        let Some(Out::YMap(heading)) = blocks.get(&txn, &ids[0]) else {
            panic!()
        };
        let Some(Out::YText(text)) = heading.get(&txn, "text") else {
            panic!()
        };
        text.push(&mut txn, " (edited in editor)");
    }
    let update = editor.transact().encode_diff_v1(&sv);

    // 3. Editor sends the update to the core, which logs, indexes and notifies.
    core.apply_update(&page, &update).unwrap();
    assert_eq!(
        core.snapshot(&page).unwrap().get(&ids[0]).unwrap().text,
        "Week 1 (edited in editor)"
    );
    let indexed: String = core
        .conn()
        .query_row("SELECT text FROM blocks WHERE id = ?1", [&ids[0]], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(indexed, "Week 1 (edited in editor)");
    assert!(matches!(
        events.try_recv().unwrap(),
        Event::PageChanged {
            origin: Origin::Remote,
            ..
        }
    ));

    // 4. A core-side change reaches the editor via a state-vector diff.
    core.transact(&page, |tx| {
        tx.set_prop(&ids[4], "course.progress", json!(0.75))
    })
    .unwrap();
    let sv = editor.transact().state_vector().encode_v1();
    let missing = core.encode_update_for(&page, Some(&sv)).unwrap();
    assert!(missing.len() < full.len(), "only the delta is sent");
    editor
        .transact_mut()
        .apply_update(Update::decode_v1(&missing).unwrap())
        .unwrap();
    let blocks: MapRef = editor.get_or_insert_map("blocks");
    let txn = editor.transact();
    let Some(Out::YMap(row)) = blocks.get(&txn, &ids[4]) else {
        panic!()
    };
    let Some(Out::YMap(props)) = row.get(&txn, "props") else {
        panic!()
    };
    assert_eq!(
        props.get(&txn, "course.progress").unwrap().to_string(&txn),
        "0.75"
    );
}

#[test]
fn concurrent_offline_edits_converge() {
    let mut core = Core::open_in_memory().unwrap();
    let (page, ids) = sample_page(&mut core);
    let full = core.encode_update_for(&page, None).unwrap();

    // Two replicas start from the same state and edit while "offline".
    let a = Doc::new();
    let b = Doc::new();
    for d in [&a, &b] {
        d.transact_mut()
            .apply_update(Update::decode_v1(&full).unwrap())
            .unwrap();
    }
    let edit = |d: &Doc, suffix: &str| {
        let sv = d.transact().state_vector();
        let blocks = d.get_or_insert_map("blocks");
        let mut txn = d.transact_mut();
        let Some(Out::YMap(h)) = blocks.get(&txn, &ids[0]) else {
            panic!()
        };
        let Some(Out::YText(t)) = h.get(&txn, "text") else {
            panic!()
        };
        t.push(&mut txn, suffix);
        drop(txn);
        d.transact().encode_diff_v1(&sv)
    };
    let ua = edit(&a, " A");
    let ub = edit(&b, " B");

    // Delivered in either order, the core ends up with both edits.
    core.apply_update(&page, &ub).unwrap();
    core.apply_update(&page, &ua).unwrap();
    let text = core
        .snapshot(&page)
        .unwrap()
        .get(&ids[0])
        .unwrap()
        .text
        .clone();
    assert!(text.contains(" A") && text.contains(" B"), "got {text:?}");

    // And it still matches after a full replay + rebuild.
    let index = core.index_dump().unwrap();
    core.evict_all();
    core.rebuild_index().unwrap();
    assert_eq!(core.index_dump().unwrap(), index);
}

#[test]
fn event_bus_reports_commits() {
    let mut core = Core::open_in_memory().unwrap();
    let events = core.subscribe();
    let page = core.create_page("Inbox").unwrap();
    core.transact(&page, |tx| tx.append(&page, flavour::PARAGRAPH, "hi"))
        .unwrap();
    core.rebuild_index().unwrap();

    let got: Vec<_> = events.try_iter().collect();
    assert!(matches!(&got[0], Event::PageCreated { page_id, .. } if *page_id == page));
    assert!(matches!(
        &got[1],
        Event::PageChanged {
            origin: Origin::Local,
            ..
        }
    ));
    assert_eq!(got[2], Event::IndexRebuilt { pages: 1 });
}

#[test]
fn bad_updates_are_rejected_without_writing() {
    let mut core = Core::open_in_memory().unwrap();
    let page = core.create_page("p").unwrap();
    assert!(matches!(
        core.apply_update(&page, &[0xff, 0x01, 0x02]),
        Err(Error::Decode(_))
    ));
    assert_eq!(core.log_len(&page).unwrap(), 1);
    assert!(matches!(
        core.snapshot("no-such-page"),
        Err(Error::PageNotFound(_))
    ));
}

fn tempdir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("bw-core-test-{}", uuid_like()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{n:x}-{:?}", std::thread::current().id()).replace(|c: char| !c.is_alphanumeric(), "")
}
