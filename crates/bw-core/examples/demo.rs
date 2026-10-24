//! Walk through the spike end to end and print what ends up in SQLite.
//!
//!     cargo run -p bw-core --example demo
//!     cargo run -p bw-core --example demo --release -- 500 40   # rebuild benchmark size

use std::time::Instant;

use bw_core::{flavour, Core};
use serde_json::json;

fn main() -> bw_core::Result<()> {
    let args: Vec<usize> = std::env::args()
        .skip(1)
        .filter_map(|a| a.parse().ok())
        .collect();
    let (bench_pages, bench_blocks) = (
        args.first().copied().unwrap_or(200),
        args.get(1).copied().unwrap_or(40),
    );

    let mut core = Core::open_in_memory()?;
    let events = core.subscribe();

    println!("== 1. create a page and add blocks in one transaction");
    let page = core.create_page("Rust course")?;
    let (heading, lessons) = core.transact(&page, |tx| {
        let h = tx.append(&page, flavour::HEADING, "Week 1")?;
        let p = tx.append(&page, flavour::PARAGRAPH, "Ownership")?;
        tx.append(&p, flavour::PARAGRAPH, &format!("Recap of (({h}))"))?;
        let db = tx.append(&page, flavour::DATABASE, "Lessons")?;
        for (i, progress) in [(1, 1.0), (2, 0.5), (3, 0.0)] {
            let row = tx.append(&db, flavour::PAGE, &format!("Lesson {i}"))?;
            tx.set_prop(&row, "course.progress", json!(progress))?;
        }
        tx.set_prop(&page, "course.source_path", json!("~/Courses/rust"))?;
        Ok((h, db))
    })?;
    print_tree(&mut core, &page)?;

    println!("\n== 2. the truth: the update log");
    let mut stmt = core
        .conn()
        .prepare("SELECT seq, length(data) FROM updates ORDER BY seq")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (seq, len) = row?;
        println!("  seq {seq}: {len} bytes");
    }
    drop(stmt);

    println!("\n== 3. the projection: queries that never touch a Y.Doc");
    println!(
        "  db rows of Lessons:     {}",
        core.db_rows(&lessons)?.len()
    );
    println!(
        "  backlinks to heading:   {:?}",
        short(&core.backlinks(&heading)?)
    );
    let mut stmt = core.conn().prepare(
        "SELECT b.text, json_extract(p.value, '$') FROM props p JOIN blocks b ON b.id = p.block_id
         WHERE p.key = 'course.progress' ORDER BY b.position",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))? {
        let (text, progress) = row?;
        println!("  {text:<10} progress = {progress}");
    }
    drop(stmt);

    println!("\n== 4. events emitted so far");
    for e in events.try_iter() {
        println!("  {e:?}");
    }

    println!("\n== 5. rebuild benchmark: {bench_pages} pages x {bench_blocks} blocks, 1 update per block");
    let mut core = Core::open_in_memory()?;
    let started = Instant::now();
    for p in 0..bench_pages {
        let page = core.create_page(&format!("Page {p}"))?;
        for b in 0..bench_blocks {
            core.transact(&page, |tx| {
                let id = tx.append(
                    &page,
                    flavour::PARAGRAPH,
                    &format!("Block {b} links [[{page}]]"),
                )?;
                tx.set_prop(&id, "demo.n", json!(b))
            })?;
        }
    }
    println!(
        "  live writes:   {:?} ({} transactions)",
        started.elapsed(),
        bench_pages * (bench_blocks + 1)
    );
    let before = core.index_dump()?;
    let report = core.rebuild_index()?;
    println!(
        "  full rebuild:  {:?} ({} pages, {} blocks, {} updates replayed)",
        report.elapsed, report.pages, report.blocks, report.updates_replayed
    );
    assert_eq!(core.index_dump()?, before);
    println!("  rebuilt index == live index: true");

    let ids = core.page_ids()?;
    let started = Instant::now();
    for id in &ids {
        core.compact(id)?;
    }
    println!("  compact all:   {:?}", started.elapsed());
    let report = core.rebuild_index()?;
    println!(
        "  rebuild after compaction: {:?} ({} updates replayed)",
        report.elapsed, report.updates_replayed
    );
    Ok(())
}

fn print_tree(core: &mut Core, page: &str) -> bw_core::Result<()> {
    for b in core.snapshot(page)?.blocks {
        let props = if b.props.is_empty() {
            String::new()
        } else {
            format!("  {:?}", b.props)
        };
        println!(
            "  {}{:<9} {:?}{}",
            "  ".repeat(b.depth as usize),
            b.flavour,
            b.text,
            props
        );
    }
    Ok(())
}

fn short(ids: &[String]) -> Vec<&str> {
    ids.iter().map(|s| &s[..8]).collect()
}
