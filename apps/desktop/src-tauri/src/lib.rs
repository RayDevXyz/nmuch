mod db;

use db::{Block, BlockWrite, Db, Hit, Link, Page, Ref, TagCount};
use tauri::{Manager, State};

#[tauri::command]
async fn list_pages(state: State<'_, Db>) -> Result<Vec<Page>, String> {
    state.with(db::list_pages)
}

#[tauri::command]
async fn upsert_page(state: State<'_, Db>, page: Page) -> Result<(), String> {
    state.with(|c| db::upsert_page(c, &page))
}

#[tauri::command]
async fn delete_pages(state: State<'_, Db>, ids: Vec<String>) -> Result<(), String> {
    state.with(|c| db::delete_pages(c, &ids))
}

#[tauri::command]
async fn get_blocks(state: State<'_, Db>, page_id: String) -> Result<Vec<Block>, String> {
    state.with(|c| db::get_blocks(c, &page_id))
}

#[tauri::command]
async fn save_blocks(
    state: State<'_, Db>,
    page_id: String,
    writes: Vec<BlockWrite>,
    deletes: Vec<String>,
    updated_at: i64,
) -> Result<(), String> {
    state.with(|c| db::save_blocks(c, &page_id, &writes, &deletes, updated_at))
}

#[tauri::command]
async fn backlinks(state: State<'_, Db>, page_id: String) -> Result<Vec<Ref>, String> {
    state.with(|c| db::backlinks(c, &page_id))
}

#[tauri::command]
async fn mentions(
    state: State<'_, Db>,
    page_id: String,
    title: String,
) -> Result<Vec<Ref>, String> {
    state.with(|c| db::mentions(c, &page_id, &title))
}

#[tauri::command]
async fn links(state: State<'_, Db>) -> Result<Vec<Link>, String> {
    state.with(db::links)
}

#[tauri::command]
async fn tags(state: State<'_, Db>) -> Result<Vec<TagCount>, String> {
    state.with(db::tags)
}

#[tauri::command]
async fn pages_with_tag(state: State<'_, Db>, tag: String) -> Result<Vec<String>, String> {
    state.with(|c| db::pages_with_tag(c, &tag))
}

#[tauri::command]
async fn search(state: State<'_, Db>, query: String, limit: i64) -> Result<Vec<Hit>, String> {
    state.with(|c| db::search(c, &query, limit))
}

#[tauri::command]
fn db_path(state: State<'_, Db>) -> String {
    state.path.to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Db::open(dir.join("nimbus.db"))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_pages,
            upsert_page,
            delete_pages,
            get_blocks,
            save_blocks,
            backlinks,
            mentions,
            links,
            tags,
            pages_with_tag,
            search,
            db_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nimbus");
}
