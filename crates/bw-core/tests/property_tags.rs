//! Tags set in a page's "Tags" property count as the page's tags (MOC, Tags view, tag pages).

use std::collections::HashMap;

use bw_core::{Core, NewBlock, PageMeta};
use yrs::updates::decoder::Decode;
use yrs::{Any, Doc, Map, ReadTxn, Transact, Update};

/// Set the page's properties the way the app does: one plain object per property in the
/// page's `properties` map.
fn set_props(core: &mut Core, page: &str, props: Vec<(&str, &str, &str, Any)>) {
    let doc = Doc::new();
    let full = core.encode_update_for(page, None).unwrap();
    doc.transact_mut().apply_update(Update::decode_v1(&full).unwrap()).unwrap();
    let before = doc.transact().state_vector();
    let map = doc.get_or_insert_map("properties");
    {
        let mut t = doc.transact_mut();
        for k in map.keys(&t).map(str::to_string).collect::<Vec<_>>() {
            map.remove(&mut t, &k);
        }
        for (id, name, ty, value) in props {
            let mut o: HashMap<String, Any> = HashMap::new();
            o.insert("id".into(), Any::from(id));
            o.insert("name".into(), Any::from(name));
            o.insert("type".into(), Any::from(ty));
            o.insert("order".into(), Any::from("a0"));
            o.insert("value".into(), value);
            map.insert(&mut t, id, Any::from(o));
        }
    }
    let diff = doc.transact().encode_diff_v1(&before);
    assert!(core.apply_remote(page, &diff).unwrap());
}

#[test]
fn tags_property_counts_as_tags() {
    let mut core = Core::open_in_memory().unwrap();
    for (id, title) in [("dune", "Dune"), ("emma", "Emma"), ("notes", "Notes")] {
        core.create_page_with_id(id, PageMeta { title: title.into(), ..Default::default() }).unwrap();
    }
    core.transact("notes", |tx| {
        let n = tx.first_note()?;
        tx.append(&n, NewBlock::paragraph("A #reading list"))?;
        Ok(())
    })
    .unwrap();

    set_props(&mut core, "dune", vec![("p1", "Tags", "multiSelect", Any::from(vec![Any::from("Reading"), Any::from("#Sci Fi")]))]);
    set_props(&mut core, "emma", vec![("p1", "tag", "text", Any::from("reading, classic")), ("p2", "Status", "select", Any::from("reading-ish"))]);

    let mut reading = core.pages_with_tag("reading").unwrap();
    reading.sort();
    assert_eq!(reading, ["dune", "emma", "notes"], "text tags and property tags together");
    assert_eq!(core.pages_with_tag("sci-fi").unwrap(), ["dune"]);
    assert_eq!(core.pages_with_tag("classic").unwrap(), ["emma"]);
    assert!(core.pages_with_tag("reading-ish").unwrap().is_empty(), "other properties aren't tags");
    let counts: Vec<(String, i64)> = core.tags().unwrap().into_iter().map(|t| (t.tag, t.count)).collect();
    assert!(counts.contains(&("reading".into(), 3)), "{counts:?}");

    // Removing the property removes the tags; a rebuilt index agrees.
    set_props(&mut core, "dune", vec![]);
    assert!(core.pages_with_tag("sci-fi").unwrap().is_empty());
    core.rebuild_index().unwrap();
    let mut reading = core.pages_with_tag("reading").unwrap();
    reading.sort();
    assert_eq!(reading, ["emma", "notes"]);
}
