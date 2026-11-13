//! Desktop shell. All data goes through `bw-core`, the single writer: the frontend calls
//! `core_call(command, args)` (see `bw-api`) and listens to `core-event` for changes.

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{Emitter, Manager, State};

struct CoreState(Arc<Mutex<bw_core::Core>>, bw_api::Context);

/// The app's identifier before the rename to BrainWaves. Its data folder is where the old
/// Nimbus app kept `nimbus.db` (imported, never modified) and where early BrainWaves builds
/// kept `brainwaves.db` (moved once, see `adopt_early_workspace`).
const OLD_IDENTIFIER: &str = "app.nimbus.notes";

/// Runs off the main thread: a call can take a moment (fetching a 5etools file, a big import)
/// and must not freeze the window meanwhile.
#[tauri::command]
async fn core_call(
    state: State<'_, CoreState>,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let (core, ctx) = (state.0.clone(), state.1.clone());
    let args = args.unwrap_or(Value::Object(Default::default()));
    tauri::async_runtime::spawn_blocking(move || {
        // Slow host work (fetching 5etools files) runs without holding the core.
        if let Some(r) = bw_api::fivee::dispatch_unlocked(&core, &command, &args) {
            return r;
        }
        let mut core = core.lock().map_err(|e| e.to_string())?;
        bw_api::dispatch(&mut core, &ctx, &command, args)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ask the user for a folder (for a module: the answer becomes the module's to read).
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle, title: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut dialog = app.dialog().file();
    if let Some(t) = title {
        dialog = dialog.set_title(t);
    }
    dialog.pick_folder(move |f| {
        let _ = tx.send(
            f.and_then(|p| p.into_path().ok())
                .map(|p| p.display().to_string()),
        );
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()
}

/// Builds made before the rename stored `brainwaves.db` in the old folder. Move it (and its
/// WAL files) to the new folder once, if the new folder has no workspace yet.
fn adopt_early_workspace(old_dir: &Path, new_dir: &Path) {
    let old = old_dir.join("brainwaves.db");
    if !old.is_file() || new_dir.join("brainwaves.db").exists() {
        return;
    }
    for suffix in ["", "-wal", "-shm"] {
        let from = old_dir.join(format!("brainwaves.db{suffix}"));
        if from.exists() {
            if let Err(e) = std::fs::rename(&from, new_dir.join(format!("brainwaves.db{suffix}"))) {
                eprintln!("could not move {}: {e}", from.display());
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let old_dir = dir.parent().map(|p| p.join(OLD_IDENTIFIER));
            if let Some(old_dir) = &old_dir {
                adopt_early_workspace(old_dir, &dir);
            }
            let ctx = bw_api::Context {
                nimbus_db: old_dir.map(|d| d.join("nimbus.db")),
                open_files: true,
            };

            let mut core = bw_core::Core::open(dir.join("brainwaves.db"))?;
            let events = core.subscribe();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for event in events {
                    let _ = handle.emit("core-event", &event);
                }
            });
            let core = Arc::new(Mutex::new(core));
            bw_api::watch::spawn(core.clone());
            app.manage(CoreState(core, ctx));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core_call, pick_folder])
        .run(tauri::generate_context!())
        .expect("error while running BrainWaves");
}
