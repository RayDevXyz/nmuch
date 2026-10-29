//! Watching the folders modules may read, shared by the desktop app and the dev server.
//!
//! The core decides *which* folders (every folder an approved module was given, see
//! `Core::watch_roots`); this thread watches them with the OS's file notifications. When files
//! change it waits for a quiet moment (copying a 2 GB video fires many events), then:
//!
//! - re-syncs any course in that folder (the Course module is first-party Rust), and
//! - emits `fsChanged` so the frontend can pass it on to the module that owns the folder.
//!
//! It also syncs every course once at startup: folders change while the app is closed too.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bw_core::course::MODULE_ID as COURSE;
use bw_core::Core;
use notify::{EventKind, RecursiveMode, Watcher};

const QUIET: Duration = Duration::from_millis(700);

pub fn spawn(core: Arc<Mutex<Core>>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(err) => {
                eprintln!("folder watching unavailable: {err}");
                return;
            }
        };
        let mut generation = None;
        let mut roots: Vec<(String, PathBuf)> = vec![];
        let mut dirty: BTreeSet<usize> = BTreeSet::new();
        let mut last: Option<Instant> = None;

        loop {
            // The set of folders changed (a folder was picked, a module revoked): re-watch.
            let g = match core.lock() {
                Ok(c) => c.watch_generation(),
                Err(_) => return,
            };
            if generation != Some(g) {
                let first = generation.is_none();
                generation = Some(g);
                for (_, r) in &roots {
                    let _ = watcher.unwatch(r);
                }
                roots = core
                    .lock()
                    .ok()
                    .and_then(|c| c.watch_roots().ok())
                    .unwrap_or_default();
                roots.dedup();
                for (_, r) in &roots {
                    if let Err(err) = watcher.watch(r, RecursiveMode::Recursive) {
                        eprintln!("can't watch {}: {err}", r.display());
                    }
                }
                // New folders (and every folder at startup) get one sync right away.
                if first || !roots.is_empty() {
                    dirty.extend(0..roots.len());
                    last = Some(Instant::now() - QUIET);
                }
            }

            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(event)) => {
                    if !matches!(event.kind, EventKind::Access(_)) {
                        for p in &event.paths {
                            for (i, (_, r)) in roots.iter().enumerate() {
                                if p.starts_with(r) {
                                    dirty.insert(i);
                                }
                            }
                        }
                        last = Some(Instant::now());
                    }
                }
                Ok(Err(err)) => eprintln!("folder watch error: {err}"),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }

            if last.is_some_and(|t| t.elapsed() >= QUIET) && !dirty.is_empty() {
                let Ok(mut c) = core.lock() else { return };
                for i in std::mem::take(&mut dirty) {
                    let Some((module, root)) = roots.get(i) else {
                        continue;
                    };
                    if module == COURSE {
                        if let Err(err) = c.course_sync_under(root) {
                            eprintln!("course sync in {}: {err}", root.display());
                        }
                    }
                    c.notify_fs_changed(module, root);
                }
                last = None;
            }
        }
    })
}
