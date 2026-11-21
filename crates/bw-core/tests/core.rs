//! Acceptance tests for the core. Each test proves one claim from the architecture doc
//! or from the phase 2 page layout (notes holding y-prosemirror XML).

use bw_core::{
    node, Core, Error, Event, Inline, NewBlock, Origin, PageMeta, PageMetaPatch, RefKind,
};
use serde_json::json;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, GetString, Map, MapRef, Out, ReadTxn, Text, Transact, Update, XmlFragment, XmlOut};

fn meta(title: &str) -> PageMeta {
    PageMeta {
        title: title.into(),
        key: "a0".into(),
        ..Default::default()
    }
}

struct Sample {
    page: String,
    target: String,
    note: String,
    heading: String,
    para: String,
    list: String,
    tasks: String,
}

/// Two pages. "Rust course" has a heading, a paragraph linking to the other page and to the
/// heading, a bullet list and a task list.
fn sample(core: &mut Core) -> Sample {
    let target = core.create_page(meta("Reading list")).unwrap();
    let page = core.create_page(meta("Rust course")).unwrap();
    let t = target.clone();
    let (note, heading, para, list, tasks) = core
        .transact(&page, |tx| {
            let note = tx.first_note()?;
            let h = tx.append(&note, NewBlock::heading(1, "Week 1"))?;
            let p = tx.append(
                &note,
                NewBlock::paragraph_with(vec![
                    "See ".into(),
                    Inline::Ref {
                        kind: RefKind::Page,
                        target: t.clone(),
                    },
                    " and ".into(),
                    Inline::Ref {
                        kind: RefKind::Block,
                        target: h.clone(),
                    },
                    " #rust #Week-1".into(),
                ]),
            )?;
            let l = tx.append(&note, NewBlock::bullet_list(&["Ownership", "Borrowing"]))?;
            let tl = tx.append(
                &note,
                NewBlock::task_list(&[("Lesson 1", true), ("Lesson 2", false)]),
            )?;
            tx.set_prop(&page, "course.source_path", json!("~/Courses/rust"))?;
            tx.set_prop(&h, "course.progress", json!(0.5))?;
            Ok((note, h, p, l, tl))
        })
        .unwrap();
    Sample {
        page,
        target,
        note,
        heading,
        para,
        list,
        tasks,
    }
}

#[test]
fn page_layout_round_trips_through_snapshot() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let snap = core.snapshot(&s.page).unwrap();

    assert_eq!(snap.meta.title, "Rust course");
    assert_eq!(snap.root().flavour, node::PAGE);
    assert_eq!(snap.notes().count(), 1);

    let flavours: Vec<_> = snap
        .content()
        .map(|b| (b.flavour.as_str(), b.depth))
        .collect();
    assert_eq!(
        flavours,
        vec![
            ("paragraph", 2), // the empty paragraph every new note starts with
            ("heading", 2),
            ("paragraph", 2),
            ("bulletList", 2),
            ("listItem", 3),
            ("paragraph", 4),
            ("listItem", 3),
            ("paragraph", 4),
            ("taskList", 2),
            ("taskItem", 3),
            ("paragraph", 4),
            ("taskItem", 3),
            ("paragraph", 4),
        ]
    );
    let h = snap.get(&s.heading).unwrap();
    assert_eq!(h.attrs["level"], json!(1));
    assert_eq!(h.props["course.progress"], json!(0.5));
    assert_eq!(h.note_id.as_deref(), Some(s.note.as_str()));

    let p = snap.get(&s.para).unwrap();
    assert_eq!(p.text, "See \u{FFFC} and \u{FFFC} #rust #Week-1");
    assert_eq!(
        p.refs,
        vec![
            (s.target.clone(), "page".into()),
            (s.heading.clone(), "block".into())
        ]
    );

    let first_task = snap
        .blocks
        .iter()
        .find(|b| b.flavour == "taskItem")
        .unwrap();
    assert_eq!(first_task.attrs["checked"], json!(true));
    assert_eq!(
        snap.root().props["course.source_path"],
        json!("~/Courses/rust")
    );
}

#[test]
fn queries_answer_from_the_index() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);

    let pages = core.list_pages().unwrap();
    assert_eq!(pages.len(), 2);

    let back = core.backlinks(&s.target).unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].block_id, s.para);
    // Inline refs render as the target's *current* title.
    assert_eq!(back[0].text, "See Reading list and Week 1 #rust #Week-1");

    core.update_page(
        &s.target,
        &PageMetaPatch {
            title: Some("Books".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        core.backlinks(&s.target).unwrap()[0].text,
        "See Books and Week 1 #rust #Week-1"
    );

    // A block ref counts as a backlink to the page holding the block... but not from itself.
    assert!(core.backlinks(&s.page).unwrap().is_empty());

    let links = core.links().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(
        (links[0].source.as_str(), links[0].target.as_str()),
        (s.page.as_str(), s.target.as_str())
    );

    let tags: Vec<_> = core
        .tags()
        .unwrap()
        .into_iter()
        .map(|t| (t.tag, t.count))
        .collect();
    assert_eq!(
        tags,
        vec![("rust".to_string(), 1), ("week-1".to_string(), 1)]
    );
    assert_eq!(core.pages_with_tag("RUST").unwrap(), vec![s.page.clone()]);

    let hits = core.search("borrow", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].text, "Borrowing");
    let hits = core.search("rust", 10).unwrap();
    assert_eq!(hits[0].block_id, None, "page titles come first");

    // Unlinked mentions: "Week 1" appears as text in the heading... of the same page, so none.
    let other = core.create_page(meta("Notes")).unwrap();
    core.transact(&other, |tx| {
        let n = tx.first_note()?;
        tx.append(
            &n,
            NewBlock::paragraph("I should finish the Rust course soon"),
        )
    })
    .unwrap();
    let m = core.mentions(&s.page, "Rust course").unwrap();
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].page_id, other);

    let info = core
        .block_infos(&[s.heading.clone(), "nope".into()])
        .unwrap();
    assert_eq!(info.len(), 1);
    assert_eq!(info[0].text, "Week 1");

    // Trash hides a page from search, tags and backlinks.
    core.update_page(
        &s.page,
        &PageMetaPatch {
            trashed_at: Some(Some(1)),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(core.tags().unwrap().is_empty());
    assert!(core.backlinks(&s.target).unwrap().is_empty());
}

#[test]
fn page_metadata_lives_in_the_doc() {
    let mut core = Core::open_in_memory().unwrap();
    let parent = core.create_page(meta("Parent")).unwrap();
    let child = core
        .create_page_with_id(
            "child-1",
            PageMeta {
                parent_id: Some(parent.clone()),
                ..meta("Child")
            },
        )
        .unwrap();
    assert_eq!(child, "child-1");
    assert!(matches!(
        core.create_page_with_id("child-1", meta("dup")),
        Err(Error::Invalid(_))
    ));

    let patch: PageMetaPatch =
        serde_json::from_value(json!({ "icon": "📚", "favorite": true, "parentId": null }))
            .unwrap();
    core.update_page(&child, &patch).unwrap();

    let row = core
        .list_pages()
        .unwrap()
        .into_iter()
        .find(|p| p.id == child)
        .unwrap();
    assert_eq!(row.icon, "📚");
    assert!(row.favorite);
    assert_eq!(
        row.parent_id, None,
        "explicit null moves the page to the top level"
    );
    assert_eq!(row.title, "Child", "fields not in the patch are kept");
    assert!(row.updated_at >= row.created_at);
}

#[test]
fn edits_moves_and_deletes_are_reflected() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let snap = core.snapshot(&s.page).unwrap();
    let items: Vec<String> = snap
        .blocks
        .iter()
        .filter(|b| b.flavour == "listItem")
        .map(|b| b.id.clone())
        .collect();
    let first_task = snap
        .blocks
        .iter()
        .find(|b| b.flavour == "taskItem")
        .unwrap()
        .id
        .clone();

    core.transact(&s.page, |tx| {
        tx.set_text(&s.heading, "Week 1: Basics")?;
        tx.set_attr(&s.heading, "level", json!(2))?;
        tx.set_attr(&first_task, "checked", json!(false))?;
        tx.move_block(&s.heading, &s.note, Some(0))?; // to the top
        tx.move_block(&items[1], &s.list, Some(0))?; // reorder list items
        tx.remove_prop(&s.page, "course.source_path")?;
        Ok(())
    })
    .unwrap();

    let snap = core.snapshot(&s.page).unwrap();
    let top: Vec<_> = snap
        .content()
        .filter(|b| b.depth == 2)
        .map(|b| b.id.as_str())
        .collect();
    assert_eq!(top[0], s.heading, "moved to the top, id preserved");
    let h = snap.get(&s.heading).unwrap();
    assert_eq!(
        (h.text.as_str(), &h.attrs["level"]),
        ("Week 1: Basics", &json!(2))
    );
    assert_eq!(
        h.props["course.progress"],
        json!(0.5),
        "props follow the id across a move"
    );
    let order: Vec<_> = snap
        .blocks
        .iter()
        .filter(|b| b.flavour == "listItem")
        .map(|b| b.id.clone())
        .collect();
    assert_eq!(order, vec![items[1].clone(), items[0].clone()]);
    assert!(snap.root().props.is_empty());

    // Deleting the last item of a list removes the list as well.
    core.transact(&s.page, |tx| {
        tx.delete_block(&items[0])?;
        tx.delete_block(&items[1])
    })
    .unwrap();
    let snap = core.snapshot(&s.page).unwrap();
    assert!(snap.get(&s.list).is_none());

    // Deleting the opening paragraph of a task item deletes the item.
    let task_para = snap
        .blocks
        .iter()
        .find(|b| b.parent.as_deref() == Some(first_task.as_str()))
        .unwrap()
        .id
        .clone();
    core.transact(&s.page, |tx| tx.delete_block(&task_para))
        .unwrap();
    let snap = core.snapshot(&s.page).unwrap();
    assert!(snap.get(&first_task).is_none());
    assert!(snap.get(&s.tasks).is_some());

    // A note is never left empty.
    let ids: Vec<String> = snap
        .content()
        .filter(|b| b.depth == 2)
        .map(|b| b.id.clone())
        .collect();
    core.transact(&s.page, |tx| {
        ids.iter().try_for_each(|id| tx.delete_block(id))
    })
    .unwrap();
    let snap = core.snapshot(&s.page).unwrap();
    assert_eq!(
        snap.content()
            .map(|b| b.flavour.as_str())
            .collect::<Vec<_>>(),
        vec!["paragraph"]
    );
}

#[test]
fn schema_rules_are_enforced() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let bad = |core: &mut Core, f: &dyn Fn(&mut bw_core::BlockTxn) -> bw_core::Result<()>| {
        let e = core.transact(&s.page, |tx| f(tx)).unwrap_err();
        assert!(matches!(e, Error::Invalid(_)), "{e:?}");
    };
    bad(&mut core, &|tx| {
        tx.append(&s.heading, NewBlock::paragraph("x")).map(|_| ())
    }); // heading holds text only
    bad(&mut core, &|tx| {
        tx.append(&s.list, NewBlock::paragraph("x")).map(|_| ())
    }); // lists hold list items
    bad(&mut core, &|tx| tx.move_block(&s.list, &s.list, None)); // into itself
    bad(&mut core, &|tx| tx.set_text(&s.list, "x")); // not a text block
    bad(&mut core, &|tx| tx.set_attr(&s.heading, "id", json!("x")));
    let e = core
        .transact(&s.page, |tx| tx.set_text("nope", "x"))
        .unwrap_err();
    assert!(matches!(e, Error::BlockNotFound(_)));
}

#[test]
fn every_write_is_logged_and_indexed_atomically() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    assert_eq!(core.log_len(&s.page).unwrap(), 2);
    core.transact(&s.page, |_| Ok(())).unwrap();
    assert_eq!(
        core.log_len(&s.page).unwrap(),
        2,
        "an empty transaction writes nothing"
    );
}

#[test]
fn failed_transaction_persists_nothing() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let before = core.snapshot(&s.page).unwrap();
    let log_before = core.log_len(&s.page).unwrap();

    let res = core.transact(&s.page, |tx| {
        tx.set_text(&s.heading, "this must not survive")?;
        tx.delete_block("missing-block")
    });
    assert!(res.is_err());
    assert_eq!(core.log_len(&s.page).unwrap(), log_before);
    assert_eq!(
        core.snapshot(&s.page).unwrap(),
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
        let s = sample(&mut core);
        let snap = core.snapshot(&s.page).unwrap();
        (s.page, snap)
    };
    let mut core = Core::open(&path).unwrap();
    assert_eq!(core.page_ids().unwrap().len(), 2);
    assert_eq!(core.snapshot(&page).unwrap(), snap);
}

#[test]
fn rebuilt_index_equals_incremental_index() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let s2 = sample(&mut core);
    core.transact(&s.page, |tx| {
        tx.delete_block(&s.list)?;
        let n = tx.add_note();
        tx.append(&n, NewBlock::callout("💡", "Second note #idea"))?;
        Ok(())
    })
    .unwrap();
    core.update_page(
        &s2.page,
        &PageMetaPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();

    let incremental = core.index_dump().unwrap();
    let report = core.rebuild_index().unwrap();
    assert_eq!(report.pages, 4);
    assert_eq!(report.blocks, incremental.blocks.len());
    assert_eq!(core.index_dump().unwrap(), incremental);
}

#[test]
fn deleted_index_is_rebuilt_on_open() {
    let dir = tempdir();
    let path = dir.join("workspace.db");
    let expected = {
        let mut core = Core::open(&path).unwrap();
        sample(&mut core);
        core.index_dump().unwrap()
    };
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute_batch("DROP TABLE page_meta; DROP TABLE blocks; DROP TABLE refs; DROP TABLE tags; DROP TABLE index_state;")
        .unwrap();
    drop(raw);

    let core = Core::open(&path).unwrap();
    assert_eq!(core.index_dump().unwrap(), expected);
}

#[test]
fn compaction_keeps_the_document_identical() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    for i in 0..20 {
        core.transact(&s.page, |tx| tx.set_text(&s.heading, &format!("Week {i}")))
            .unwrap();
    }
    let snap = core.snapshot(&s.page).unwrap();
    let index = core.index_dump().unwrap();
    assert_eq!(core.compact(&s.page).unwrap(), 22);
    assert_eq!(core.log_len(&s.page).unwrap(), 1);

    core.evict_all();
    assert_eq!(core.snapshot(&s.page).unwrap(), snap);
    core.rebuild_index().unwrap();
    assert_eq!(core.index_dump().unwrap(), index, "including updated_at");
}

#[test]
fn delete_forever_removes_log_and_index() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let events = core.subscribe();
    core.delete_pages(std::slice::from_ref(&s.target)).unwrap();
    assert_eq!(core.page_ids().unwrap(), vec![s.page.clone()]);
    assert!(matches!(
        core.snapshot(&s.target),
        Err(Error::PageNotFound(_))
    ));
    assert_eq!(
        events.try_recv().unwrap(),
        Event::PageDeleted {
            page_id: s.target.clone()
        }
    );
    // The dangling ref stays in the source page; it simply resolves to "Untitled".
    let dump_before = core.index_dump().unwrap();
    core.rebuild_index().unwrap();
    assert_eq!(core.index_dump().unwrap(), dump_before);
}

/// Read one note's XML the way the editor would see it.
fn note_xml(doc: &Doc, note: &str) -> String {
    let notes: MapRef = doc.get_or_insert_map("notes");
    let txn = doc.transact();
    let Some(Out::YMap(n)) = notes.get(&txn, note) else {
        panic!("no note")
    };
    let Some(Out::YXmlFragment(f)) = n.get(&txn, "content") else {
        panic!("no content")
    };
    f.get_string(&txn)
}

/// The editor flow: the frontend keeps its own Y.Doc, syncs it from the core, edits it,
/// and sends the resulting update back. The core is still the only thing writing to disk.
#[test]
fn editor_updates_flow_through_the_core() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let events = core.subscribe();

    let editor = Doc::new();
    let full = core.encode_update_for(&s.page, None).unwrap();
    editor
        .transact_mut()
        .apply_update(Update::decode_v1(&full).unwrap())
        .unwrap();
    assert!(note_xml(&editor, &s.note).contains("<heading"));

    // The user types at the end of the heading, inside the editor's own doc.
    let sv = editor.transact().state_vector();
    {
        let notes: MapRef = editor.get_or_insert_map("notes");
        let mut txn = editor.transact_mut();
        let Some(Out::YMap(n)) = notes.get(&txn, &s.note) else {
            panic!()
        };
        let Some(Out::YXmlFragment(f)) = n.get(&txn, "content") else {
            panic!()
        };
        let Some(XmlOut::Element(h)) = f.get(&txn, 1) else {
            panic!()
        };
        let Some(XmlOut::Text(t)) = h.get(&txn, 0) else {
            panic!()
        };
        t.push(&mut txn, " (edited)");
    }
    let update = editor.transact().encode_diff_v1(&sv);
    core.apply_update(&s.page, &update).unwrap();

    assert_eq!(
        core.snapshot(&s.page)
            .unwrap()
            .get(&s.heading)
            .unwrap()
            .text,
        "Week 1 (edited)"
    );
    assert_eq!(
        core.search("(edited)", 5).unwrap()[0].block_id.as_deref(),
        Some(s.heading.as_str())
    );
    assert!(matches!(
        events.try_recv().unwrap(),
        Event::PageChanged {
            origin: Origin::Remote,
            ..
        }
    ));

    // A core-side change reaches the editor as a state-vector diff.
    core.transact(&s.page, |tx| tx.set_attr(&s.heading, "level", json!(3)))
        .unwrap();
    let sv = editor.transact().state_vector().encode_v1();
    let missing = core.encode_update_for(&s.page, Some(&sv)).unwrap();
    assert!(missing.len() < full.len(), "only the delta is sent");
    editor
        .transact_mut()
        .apply_update(Update::decode_v1(&missing).unwrap())
        .unwrap();
    assert!(note_xml(&editor, &s.note).contains(r#"level="3""#));
}

#[test]
fn concurrent_offline_edits_converge() {
    let mut core = Core::open_in_memory().unwrap();
    let s = sample(&mut core);
    let full = core.encode_update_for(&s.page, None).unwrap();

    let edit = |suffix: &str| {
        let d = Doc::new();
        d.transact_mut()
            .apply_update(Update::decode_v1(&full).unwrap())
            .unwrap();
        let sv = d.transact().state_vector();
        let notes: MapRef = d.get_or_insert_map("notes");
        {
            let mut txn = d.transact_mut();
            let Some(Out::YMap(n)) = notes.get(&txn, &s.note) else {
                panic!()
            };
            let Some(Out::YXmlFragment(f)) = n.get(&txn, "content") else {
                panic!()
            };
            let Some(XmlOut::Element(h)) = f.get(&txn, 1) else {
                panic!()
            };
            let Some(XmlOut::Text(t)) = h.get(&txn, 0) else {
                panic!()
            };
            t.push(&mut txn, suffix);
        }
        let update = d.transact().encode_diff_v1(&sv);
        update
    };
    let (ua, ub) = (edit(" A"), edit(" B"));
    core.apply_update(&s.page, &ub).unwrap();
    core.apply_update(&s.page, &ua).unwrap();
    let text = core
        .snapshot(&s.page)
        .unwrap()
        .get(&s.heading)
        .unwrap()
        .text
        .clone();
    assert!(text.contains(" A") && text.contains(" B"), "got {text:?}");

    let index = core.index_dump().unwrap();
    core.evict_all();
    core.rebuild_index().unwrap();
    assert_eq!(core.index_dump().unwrap(), index);
}

#[test]
fn event_bus_reports_commits() {
    let mut core = Core::open_in_memory().unwrap();
    let events = core.subscribe();
    let page = core.create_page(meta("Inbox")).unwrap();
    core.transact(&page, |tx| {
        let n = tx.first_note()?;
        tx.append(&n, NewBlock::paragraph("hi"))
    })
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
    // Events serialize the way the frontend expects.
    assert_eq!(
        serde_json::to_value(&got[2]).unwrap(),
        json!({ "type": "indexRebuilt", "pages": 1 })
    );
    assert_eq!(
        serde_json::to_value(&got[1]).unwrap()["origin"],
        json!("local")
    );
}

#[test]
fn bad_updates_are_rejected_without_writing() {
    let mut core = Core::open_in_memory().unwrap();
    let page = core.create_page(meta("p")).unwrap();
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

#[test]
fn tag_extraction_rules() {
    use bw_core::index::extract_tags;
    assert_eq!(
        extract_tags("#a b#c (#d) #1x #_e #f/g-h #A"),
        vec!["a", "d", "_e", "f/g-h"]
    );
}

fn tempdir() -> std::path::PathBuf {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(
        format!("bw-core-test-{n:x}-{:?}", std::thread::current().id()).replace(['(', ')'], ""),
    );
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn import_page_keeps_dates_and_validates() {
    // Build a page the way an importer would: in its own doc, then hand over one update.
    let mut source = Core::open_in_memory().unwrap();
    let id = source
        .create_page_with_id("imported", meta("From elsewhere"))
        .unwrap();
    source
        .transact(&id, |tx| {
            let n = tx.first_note()?;
            tx.append(&n, NewBlock::paragraph("old note #legacy"))
        })
        .unwrap();
    let update = source.encode_update_for(&id, None).unwrap();

    let mut core = Core::open_in_memory().unwrap();
    let events = core.subscribe();
    core.import_page(&id, &update, 1_000, 5_000).unwrap();
    let row = core
        .list_pages()
        .unwrap()
        .into_iter()
        .find(|p| p.id == id)
        .unwrap();
    assert_eq!((row.created_at, row.updated_at), (1_000, 5_000));
    assert_eq!(core.pages_with_tag("legacy").unwrap(), vec![id.clone()]);
    assert_eq!(core.log_len(&id).unwrap(), 1);
    assert!(matches!(
        events.try_recv().unwrap(),
        Event::PageCreated { .. }
    ));

    // Survives a rebuild with the same dates.
    let dump = core.index_dump().unwrap();
    core.rebuild_index().unwrap();
    assert_eq!(core.index_dump().unwrap(), dump);

    // Rejected: duplicates, wrong id, garbage. Nothing is written.
    assert!(matches!(
        core.import_page(&id, &update, 0, 0),
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        core.import_page("other-id", &update, 0, 0),
        Err(Error::Invalid(_)) | Err(Error::PageNotFound(_))
    ));
    assert!(core.import_page("x", &[1, 2, 3], 0, 0).is_err());
    assert_eq!(core.page_ids().unwrap(), vec![id]);
}

#[test]
fn a_page_keeps_its_theme_through_a_rebuild() {
    let mut core = Core::open_in_memory().unwrap();
    let page = core.create_page(meta("Moodboard")).unwrap();
    let patch: PageMetaPatch = serde_json::from_value(json!({ "theme": "midnight" })).unwrap();
    core.update_page(&page, &patch).unwrap();
    let theme = |core: &Core| core.list_pages().unwrap().into_iter().find(|p| p.id == page).unwrap().theme;
    assert_eq!(theme(&core), "midnight");
    // Only a plain id is kept, never markup.
    let odd: PageMetaPatch = serde_json::from_value(json!({ "theme": "x</style><b>" })).unwrap();
    core.update_page(&page, &odd).unwrap();
    assert_eq!(theme(&core), "xstyleb");
    core.update_page(&page, &patch).unwrap();
    core.rebuild_index().unwrap();
    assert_eq!(theme(&core), "midnight", "the theme lives in the page, not only the index");
}
