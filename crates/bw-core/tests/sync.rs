//! Two-way sync between two workspaces, through the `Remote` interface (here: another core).

use std::sync::Mutex;

use bw_core::sync::{sync_round, Changes, Cursor, Remote, Report, SyncState};
use bw_core::{Core, NewBlock, PageMeta, PageMetaPatch};

struct Other<'a>(&'a Mutex<Core>);

impl Remote for Other<'_> {
    fn changes(&mut self, since: Cursor) -> Result<Changes, String> {
        self.0.lock().unwrap().changes_since(since).map_err(|e| e.to_string())
    }
    fn page(&mut self, id: &str, sv: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        let mut c = self.0.lock().unwrap();
        if !c.page_exists(id).unwrap() {
            return Ok((vec![], c.state_vector(id).unwrap()));
        }
        Ok((c.encode_update_for(id, Some(sv)).unwrap(), c.state_vector(id).unwrap()))
    }
    fn push(&mut self, id: &str, update: &[u8]) -> Result<bool, String> {
        self.0.lock().unwrap().apply_remote(id, update).map_err(|e| e.to_string())
    }
    fn delete(&mut self, ids: &[String]) -> Result<(), String> {
        let mut c = self.0.lock().unwrap();
        let here: Vec<String> = ids.iter().filter(|id| c.page_exists(id).unwrap()).cloned().collect();
        c.delete_pages(&here).map_err(|e| e.to_string())
    }
}

/// Sync until a round finds nothing to do; returns how many rounds that took.
fn settle(a: &Mutex<Core>, b: &Mutex<Core>, st: &mut SyncState) -> usize {
    for n in 1..=6 {
        let r = sync_round(a, &mut Other(b), st).unwrap();
        if r == Report::default() {
            return n;
        }
    }
    panic!("sync did not settle")
}

fn text(c: &Mutex<Core>, id: &str) -> Vec<String> {
    let snap = c.lock().unwrap().snapshot(id).unwrap();
    snap.content().filter(|b| !b.text.is_empty()).map(|b| b.text.clone()).collect()
}

fn titles(c: &Mutex<Core>) -> Vec<String> {
    let mut t: Vec<String> = c.lock().unwrap().list_pages().unwrap().into_iter().map(|p| p.title).collect();
    t.sort();
    t
}

fn page(c: &Mutex<Core>, id: &str, title: &str, line: &str) {
    let mut core = c.lock().unwrap();
    core.create_page_with_id(id, PageMeta { title: title.into(), ..Default::default() }).unwrap();
    core.transact(id, |tx| {
        let n = tx.first_note()?;
        tx.append(&n, NewBlock::paragraph(line))?;
        Ok(())
    })
    .unwrap();
}

fn append(c: &Mutex<Core>, id: &str, line: &str) {
    c.lock()
        .unwrap()
        .transact(id, |tx| {
            let n = tx.first_note()?;
            tx.append(&n, NewBlock::paragraph(line))?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn two_workspaces_converge() {
    let desktop = Mutex::new(Core::open_in_memory().unwrap());
    let server = Mutex::new(Core::open_in_memory().unwrap());
    let mut st = SyncState::default();

    // Each side has its own pages: after a sync, both have all of them.
    page(&desktop, "d1", "Written on the laptop", "offline thoughts");
    page(&server, "s1", "Written on the phone", "on the train");
    settle(&desktop, &server, &mut st);
    assert_eq!(titles(&desktop), ["Written on the laptop", "Written on the phone"]);
    assert_eq!(titles(&server), titles(&desktop));
    assert_eq!(text(&server, "d1"), ["offline thoughts"]);

    // Nothing changed: a round does nothing at all.
    assert_eq!(sync_round(&desktop, &mut Other(&server), &mut st).unwrap(), Report::default());

    // Both edit the same page while apart: the edits merge.
    append(&desktop, "s1", "added on the laptop");
    append(&server, "s1", "added on the phone");
    desktop.lock().unwrap().update_page("s1", &PageMetaPatch { icon: Some("🚆".into()), ..Default::default() }).unwrap();
    settle(&desktop, &server, &mut st);
    let mut lines = text(&desktop, "s1");
    lines.sort();
    assert_eq!(lines, ["added on the laptop", "added on the phone", "on the train"]);
    assert_eq!(text(&server, "s1").len(), 3);
    assert_eq!(server.lock().unwrap().snapshot("s1").unwrap().meta.icon, "🚆");
    // The merge doesn't bounce: no page log keeps growing.
    let before = (desktop.lock().unwrap().log_len("s1").unwrap(), server.lock().unwrap().log_len("s1").unwrap());
    settle(&desktop, &server, &mut st);
    assert_eq!(before, (desktop.lock().unwrap().log_len("s1").unwrap(), server.lock().unwrap().log_len("s1").unwrap()));

    // Trash is a page change like any other; delete forever is a tombstone.
    server.lock().unwrap().update_page("d1", &PageMetaPatch { trashed_at: Some(Some(1)), ..Default::default() }).unwrap();
    settle(&desktop, &server, &mut st);
    assert_eq!(desktop.lock().unwrap().snapshot("d1").unwrap().meta.trashed_at, Some(1));
    desktop.lock().unwrap().delete_pages(&["d1".into()]).unwrap();
    settle(&desktop, &server, &mut st);
    assert!(!server.lock().unwrap().page_exists("d1").unwrap());

    // A page deleted there while edited here: the deletion wins.
    append(&desktop, "s1", "one more line");
    server.lock().unwrap().delete_pages(&["s1".into()]).unwrap();
    settle(&desktop, &server, &mut st);
    assert!(!desktop.lock().unwrap().page_exists("s1").unwrap());
    assert!(!server.lock().unwrap().page_exists("s1").unwrap());
    assert!(titles(&desktop).is_empty() && titles(&server).is_empty());
}

#[test]
fn a_second_desktop_catches_up_from_the_server() {
    let laptop = Mutex::new(Core::open_in_memory().unwrap());
    let server = Mutex::new(Core::open_in_memory().unwrap());
    let pc = Mutex::new(Core::open_in_memory().unwrap());
    let (mut a, mut b) = (SyncState::default(), SyncState::default());
    page(&laptop, "p", "Plans", "from the laptop");
    settle(&laptop, &server, &mut a);
    settle(&pc, &server, &mut b);
    append(&pc, "p", "from the pc");
    settle(&pc, &server, &mut b);
    settle(&laptop, &server, &mut a);
    let mut lines = text(&laptop, "p");
    lines.sort();
    assert_eq!(lines, ["from the laptop", "from the pc"]);
}
