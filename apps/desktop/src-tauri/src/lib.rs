//! Desktop shell. All data goes through `bw-core`, the single writer: the frontend calls
//! `core_call(command, args)` (see `bw-api`) and listens to `core-event` for changes.

use std::sync::Mutex;

use serde_json::Value;
use tauri::{Emitter, Manager, State};

struct CoreState(Mutex<bw_core::Core>);

#[tauri::command]
fn core_call(
    state: State<'_, CoreState>,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let mut core = state.0.lock().map_err(|e| e.to_string())?;
    bw_api::dispatch(
        &mut core,
        &command,
        args.unwrap_or(Value::Object(Default::default())),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            // A new file: the old Nimbus `nimbus.db` next to it is left untouched.
            let mut core = bw_core::Core::open(dir.join("brainwaves.db"))?;
            let events = core.subscribe();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for event in events {
                    let _ = handle.emit("core-event", &event);
                }
            });
            app.manage(CoreState(Mutex::new(core)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core_call])
        .run(tauri::generate_context!())
        .expect("error while running Nimbus");
}
