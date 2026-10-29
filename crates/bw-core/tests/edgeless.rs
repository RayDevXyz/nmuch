//! Edgeless mode: canvas elements and note placement live in the page's Y.Doc, are indexed,
//! and merge like everything else.

use bw_core::{Core, Error, PageMeta};
use serde_json::json;
use yrs::updates::decoder::Decode;
use yrs::{Doc, Map, MapPrelim, ReadTxn, Transact, Update};

fn page(core: &mut Core, title: &str) -> String {
    core.create_page(PageMeta {
        title: title.into(),
        ..Default::default()
    })
    .unwrap()
}

#[test]
fn elements_are_indexed_in_stacking_order_and_searchable() {
    let mut core = Core::open_in_memory().unwrap();
    let p = page(&mut core, "Board");
    core.transact(&p, |t| {
        t.set_element("f1", json!({ "type": "frame", "index": "a0", "xywh": [0, 0, 800, 600], "text": "Sprint one" }))?;
        t.set_element("s1", json!({ "type": "shape", "index": "a2", "xywh": [40, 40, 160, 80], "shape": "ellipse", "text": "Launch plan" }))?;
        t.set_element("c1", json!({ "type": "connector", "index": "a3", "source": { "id": "s1" }, "target": { "point": [500, 300] } }))?;
        t.set_element("t1", json!({ "type": "text", "index": "a1", "xywh": [300, 20, 120, 30], "text": "Notes from Monday" }))
    })
    .unwrap();

    let snap = core.snapshot(&p).unwrap();
    let surface: Vec<_> = snap
        .blocks
        .iter()
        .filter(|b| b.flavour.starts_with("surface."))
        .map(|b| (b.id.as_str(), b.flavour.as_str(), b.text.as_str()))
        .collect();
    assert_eq!(
        surface,
        [
            ("f1", "surface.frame", "Sprint one"),
            ("t1", "surface.text", "Notes from Monday"),
            ("s1", "surface.shape", "Launch plan"),
            ("c1", "surface.connector", ""),
        ]
    );
    let shape = snap.get("s1").unwrap();
    assert_eq!(shape.attrs["shape"], json!("ellipse"));
    assert_eq!(shape.attrs["xywh"], json!([40, 40, 160, 80]));

    let hits = core.search("launch", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].block_id.as_deref(), Some("s1"));
    assert_eq!(hits[0].page_id, p);

    // The index is a projection: rebuilding it gives the same rows.
    let before = core.index_dump().unwrap();
    core.rebuild_index().unwrap();
    assert_eq!(core.index_dump().unwrap(), before);

    core.transact(&p, |t| {
        t.update_element("s1", json!({ "text": "Launch v2" }))?;
        t.remove_element("t1");
        Ok(())
    })
    .unwrap();
    assert_eq!(core.search("monday", 10).unwrap().len(), 0);
    assert_eq!(
        core.search("v2", 10).unwrap()[0].block_id.as_deref(),
        Some("s1")
    );
}

#[test]
fn bad_elements_are_refused() {
    let mut core = Core::open_in_memory().unwrap();
    let p = page(&mut core, "Board");
    let refused = |core: &mut Core, el: serde_json::Value| {
        matches!(
            core.transact(&p, |t| t.set_element("x", el)),
            Err(Error::Invalid(_))
        )
    };
    assert!(refused(
        &mut core,
        json!({ "type": "blob", "xywh": [0, 0, 1, 1] })
    ));
    assert!(refused(
        &mut core,
        json!({ "type": "shape", "xywh": [0, 0, -5, 1] })
    ));
    assert!(refused(&mut core, json!({ "type": "shape" })));
    assert!(refused(
        &mut core,
        json!({ "type": "connector", "source": { "id": "a" } })
    ));
    assert!(refused(
        &mut core,
        json!({ "type": "text", "xywh": [0, 0, 1, 1], "text": 5 })
    ));

    core.transact(&p, |t| {
        t.set_element("s", json!({ "type": "shape", "xywh": [0, 0, 10, 10] }))
    })
    .unwrap();
    let r = core.transact(&p, |t| t.update_element("s", json!({ "type": "frame" })));
    assert!(matches!(r, Err(Error::Invalid(_))));
    // A failed transaction leaves nothing behind.
    assert!(core.snapshot(&p).unwrap().get("x").is_none());
}

#[test]
fn notes_can_be_placed_and_kept_on_the_canvas_only() {
    let mut core = Core::open_in_memory().unwrap();
    let p = page(&mut core, "Board");
    let (first, scratch) = core
        .transact(&p, |t| {
            let first = t.first_note()?;
            let scratch = t.add_note();
            t.set_note_layout(&first, Some([0.0, 0.0, 720.0, 400.0]), None)?;
            t.set_note_layout(&scratch, Some([800.0, 0.0, 300.0, 200.0]), Some("edgeless"))?;
            Ok((first, scratch))
        })
        .unwrap();
    let snap = core.snapshot(&p).unwrap();
    assert_eq!(
        snap.get(&first).unwrap().attrs["xywh"],
        json!([0, 0, 720, 400])
    );
    assert!(!snap.get(&first).unwrap().attrs.contains_key("display"));
    assert_eq!(
        snap.get(&scratch).unwrap().attrs["display"],
        json!("edgeless")
    );

    let r = core.transact(&p, |t| t.set_note_layout(&scratch, None, Some("sideways")));
    assert!(matches!(r, Err(Error::Invalid(_))));
}

/// The frontend writes elements as a `Y.Map` per element, one entry per field. Two clients
/// changing different fields of the same element at the same time both win.
#[test]
fn concurrent_edits_to_different_fields_merge() {
    let mut core = Core::open_in_memory().unwrap();
    let p = page(&mut core, "Board");
    core.transact(&p, |t| {
        t.set_element(
            "s",
            json!({ "type": "shape", "xywh": [0, 0, 100, 50], "text": "Idea" }),
        )
    })
    .unwrap();
    let base = core.encode_update_for(&p, None).unwrap();

    let client = |client_id: u64, field: &str, value: yrs::Any| {
        let doc = Doc::with_client_id(client_id);
        let surface = doc.get_or_insert_map("surface");
        doc.transact_mut()
            .apply_update(Update::decode_v1(&base).unwrap())
            .unwrap();
        let before = doc.transact().state_vector();
        {
            let mut txn = doc.transact_mut();
            let yrs::Out::YMap(el) = surface.get(&txn, "s").unwrap() else {
                panic!()
            };
            el.insert(&mut txn, field, value);
        }
        let update = doc.transact().encode_state_as_update_v1(&before);
        update
    };
    // One person moves the shape while another renames it.
    let moved = client(
        901,
        "xywh",
        yrs::Any::from(vec![
            yrs::Any::from(300.0),
            200.0.into(),
            100.0.into(),
            50.0.into(),
        ]),
    );
    let renamed = client(902, "text", yrs::Any::from("Better idea"));
    core.apply_update(&p, &moved).unwrap();
    core.apply_update(&p, &renamed).unwrap();

    let s = core.snapshot(&p).unwrap();
    let s = s.get("s").unwrap();
    assert_eq!(s.text, "Better idea");
    assert_eq!(s.attrs["xywh"], json!([300, 200, 100, 50]));

    // A whole element added by a client, as the canvas does.
    let doc = Doc::with_client_id(903);
    let surface = doc.get_or_insert_map("surface");
    doc.transact_mut()
        .apply_update(Update::decode_v1(&core.encode_update_for(&p, None).unwrap()).unwrap())
        .unwrap();
    let before = doc.transact().state_vector();
    surface.insert(
        &mut doc.transact_mut(),
        "n",
        MapPrelim::from_iter([
            ("id", yrs::In::from("n")),
            ("type", yrs::In::from("text")),
            ("index", yrs::In::from("b0")),
            (
                "xywh",
                yrs::In::Any(yrs::Any::from(vec![
                    yrs::Any::from(0.0),
                    0.0.into(),
                    10.0.into(),
                    10.0.into(),
                ])),
            ),
            ("text", yrs::In::from("from the canvas")),
        ]),
    );
    core.apply_update(&p, &doc.transact().encode_state_as_update_v1(&before))
        .unwrap();
    assert_eq!(
        core.search("canvas", 10).unwrap()[0].block_id.as_deref(),
        Some("n")
    );
}
