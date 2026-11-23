//! Writes `tests/fixtures/core-page.bin`: a page built by the Rust core with every block
//! kind it can create. The editor's contract test (`packages/editor/test/contract.test.ts`)
//! loads it and checks Tiptap accepts every node unchanged.
//!
//!     cargo run -p bw-core --example contract_fixture

use bw_core::{Core, Inline, NewBlock, PageMeta, RefKind};
use serde_json::json;

fn main() -> bw_core::Result<()> {
    let mut core = Core::open_in_memory()?;
    let other = core.create_page_with_id(
        "other-page",
        PageMeta {
            title: "Other".into(),
            ..Default::default()
        },
    )?;
    let page = core.create_page_with_id(
        "core-page",
        PageMeta {
            title: "Made in Rust".into(),
            ..Default::default()
        },
    )?;
    core.transact(&page, |tx| {
        let note = tx.first_note()?;
        let h = tx.append(&note, NewBlock::heading(2, "Heading"))?;
        tx.append(
            &note,
            NewBlock::paragraph_with(vec![
                "Text with a page ref ".into(),
                Inline::Ref {
                    kind: RefKind::Page,
                    target: other.clone(),
                },
                ", a block ref ".into(),
                Inline::Ref {
                    kind: RefKind::Block,
                    target: h.clone(),
                },
                Inline::Break,
                "and a line break.".into(),
            ]),
        )?;
        tx.append(&note, NewBlock::callout("✨", "A callout"))?;
        tx.append(&note, NewBlock::quote("A quote"))?;
        tx.append(&note, NewBlock::bullet_list(&["One", "Two"]))?;
        tx.append(
            &note,
            NewBlock::task_list(&[("Done", true), ("Open", false)]),
        )?;
        tx.append(&note, NewBlock::code("rust", "fn main() {}"))?;
        tx.append(&note, NewBlock::divider())?;
        tx.append(&note, NewBlock::page_link(&other))?;
        tx.append(&note, NewBlock::database(&other, "view-1"))?;
        tx.append(
            &note,
            NewBlock::widget(
                "progress",
                json!({ "items": { "databaseId": other, "fields": { "done": "done" } } }),
                json!({ "label": "Done" }),
            ),
        )?;
        tx.append(&note, NewBlock::moc(json!({ "source": "tag", "tag": "reading" })))?;
        tx.append(&note, NewBlock::columns(&["Left", "Right"]))?;
        tx.append(&note, NewBlock::toggle("More", vec![NewBlock::paragraph("Hidden detail")]))?;
        tx.append(&note, NewBlock::table(&[&["Name", "Role"], &["Ada", "Engineer"]]))?;
        tx.set_prop(&h, "course.progress", json!(1))?;
        let second = tx.add_note();
        tx.append(&second, NewBlock::paragraph("Second note"))?;
        Ok(())
    })?;

    let snap = core.snapshot(&page)?;
    let expected: Vec<_> = snap
        .content()
        .map(|b| json!({ "id": b.id, "type": b.flavour, "depth": b.depth }))
        .collect();
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    std::fs::write(
        dir.join("core-page.bin"),
        core.encode_update_for(&page, None)?,
    )
    .expect("write fixture");
    std::fs::write(
        dir.join("core-page.expected.json"),
        serde_json::to_string_pretty(&json!({ "pageId": page, "blocks": expected })).unwrap()
            + "\n",
    )
    .expect("write fixture");
    println!("wrote {}", dir.display());
    Ok(())
}
