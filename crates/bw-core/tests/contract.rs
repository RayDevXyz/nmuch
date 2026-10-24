//! The editor -> core half of the contract test. `editor-page.bin` is a page whose notes were
//! written by Tiptap's own Yjs binding (y-tiptap) from a ProseMirror document using every
//! node type; `editor-page.expected.json` is what the editor says those blocks are.
//! Regenerate both with `UPDATE_FIXTURES=1 pnpm --filter @brainwaves/editor test`.

use serde_json::Value;
use yrs::updates::decoder::Decode;
use yrs::{Doc, Transact, Update};

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name),
    )
    .unwrap()
}

#[test]
fn core_reads_pages_written_by_the_editor() {
    let expected: Value = serde_json::from_slice(&fixture("editor-page.expected.json")).unwrap();
    let doc = Doc::new();
    doc.transact_mut()
        .apply_update(Update::decode_v1(&fixture("editor-page.bin")).unwrap())
        .unwrap();

    let page_id = expected["pageId"].as_str().unwrap();
    let snap = bw_core::doc::snapshot(&doc, page_id).unwrap();
    assert_eq!(snap.meta.title, expected["title"].as_str().unwrap());

    let got: Vec<Value> = snap
        .content()
        .map(|b| {
            serde_json::json!({
                "id": b.id, "type": b.flavour, "depth": b.depth, "text": b.text,
                "attrs": b.attrs, "refs": b.refs.iter().map(|(t, k)| serde_json::json!([t, k])).collect::<Vec<_>>(),
            })
        })
        .collect();
    let want = expected["blocks"].as_array().unwrap();
    assert_eq!(got.len(), want.len(), "block count\n got: {got:#?}");
    for (g, w) in got.iter().zip(want) {
        assert_eq!(g, w);
    }
}
