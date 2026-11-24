//! The BrainWaves table server: the DM's battle map, live, for the players.
//!
//! The DM builds scenes in BrainWaves (their own computer). When they *go live*, BrainWaves
//! sends this server the part of the scene players may see: the map picture, the grid, the
//! visible tokens and the areas cleared of fog. Hidden monsters, fogged areas and DM notes
//! never leave the DM's computer. Players open a link in any browser (the page is served from
//! here) and see the scene update as the DM changes it.
//!
//! Players can **ping** a spot, make **temporary drawings** (gone after a few seconds), ask to
//! **move** their character (the request goes to the DM, who accepts or declines it in
//! BrainWaves), and **roll dice**, which are rolled here so nobody can fake a roll.
//!
//! - DM: `POST /api/rooms` with `Authorization: Bearer <DM key>` makes a room; the DM then
//!   connects to `/ws/<room>?key=<DM key>`.
//! - Players: `/join/<room>` is the player page; it connects to `/ws/<room>?name=…`.
//!
//! A room is a campaign's table: one link for the whole campaign. Besides the map, players
//! **build characters** there from the options the DM allows (BrainWaves sends them as the
//! room's *rules*) and submit them; the DM approves them in BrainWaves (which makes the
//! character) or sends them back with a note. Players then see their approved characters'
//! sheets (BrainWaves sends the *party*). A player is known by a random id their browser keeps
//! (`pid`), so their characters follow them from visit to visit without accounts.
//!
//! The room is also the players' **hub**: BrainWaves publishes a **compendium** (the
//! player-facing part of the DM's 5etools: spells, items, races, classes, backgrounds, feats,
//! conditions; never monsters) and **journal** pages (expedition logs, story so far, handouts).
//! Players read them here, without the DM's 5etools or BrainWaves running.
//!
//! - DM: `PUT /api/rooms/<room>/compendium/<category>` (a JSON array), then
//!   `PUT /api/rooms/<room>/compendium` (`{ sources }`, marks it published);
//!   `PUT|DELETE /api/rooms/<room>/journal/<id>` (`{ title, icon, kind, html }`).
//! - Players: `GET /api/rooms/<room>/compendium[/<category>]`, `GET /api/rooms/<room>/journal[/<id>]`.
//!
//! Rooms, their latest scene, the map pictures, recent rolls, the rules, the party, the
//! character submissions, the compendium and the journal are saved under the data folder, so a
//! restart doesn't lose the game.

pub mod dice;

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;

const MAX_SCENE: usize = 4 << 20;
const MAX_IMAGE: usize = 24 << 20;
const MAX_PLAYER_MSG: usize = 64 << 10;
const DRAWING_SECONDS: u64 = 8;
const KEEP_ROLLS: usize = 60;
const KEEP_IMAGES: usize = 6;
const MAX_RULES: usize = 1 << 20;
const MAX_PARTY: usize = 2 << 20;
const MAX_CHARACTER: usize = 32 << 10;
/// Open (not yet approved) submissions one player may have at once.
const MAX_OPEN_SUBMISSIONS: usize = 8;
const KEEP_SUBMISSIONS: usize = 200;
/// One compendium category (classes with their features are the biggest).
const MAX_CATEGORY: usize = 48 << 20;
/// One journal page (pictures are inside it).
const MAX_PAGE: usize = 16 << 20;
const MAX_JOURNAL: usize = 500;
/// What players may read: the player-facing 5e content (no monsters).
pub const CATEGORIES: [&str; 7] = ["spell", "item", "race", "class", "background", "feat", "condition"];

pub struct Config {
    pub data: PathBuf,
    pub dm_key: String,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

struct Inner {
    data: PathBuf,
    dm_key: String,
    rooms: Mutex<HashMap<String, Room>>,
    next_conn: AtomicU64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Saved {
    name: String,
    scene: Value,
    rolls: VecDeque<Value>,
    /// Picture hash → content type, in the order they arrived.
    images: Vec<(String, String)>,
    /// What players may build characters from (races, classes, … the DM allows), from BrainWaves.
    rules: Value,
    /// The campaign's characters: `[{ id, name, player, sheet }]`, from BrainWaves.
    party: Vec<Value>,
    /// Characters players submitted: `{ id, pid, player, character, status, note, at, characterId }`.
    submissions: Vec<Value>,
    /// Character id → the player (pid) it belongs to (set when the DM approves a submission).
    owners: BTreeMap<String, String>,
    /// The published compendium: `{ publishedAt, sources, counts: { category: n } }` (the
    /// entries themselves are files next to the room's).
    compendium: Value,
    /// Published journal pages, without their content: `{ id, title, icon, kind, published, updated }`.
    journal: Vec<Value>,
}

struct Room {
    saved: Saved,
    conns: BTreeMap<u64, Conn>,
    requests: BTreeMap<String, Value>,
    dirty: bool,
}

struct Conn {
    dm: bool,
    /// The player's browser id (players only; none for an old page).
    pid: Option<String>,
    name: String,
    claim: Option<String>,
    color: String,
    tx: mpsc::UnboundedSender<String>,
    /// Simple rate limit: messages in the current second.
    window: (u64, u32),
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn valid_pid(pid: &str) -> bool {
    (16..=64).contains(&pid.len()) && pid.chars().all(|c| c.is_ascii_alphanumeric())
}

fn valid_code(code: &str) -> bool {
    (6..=32).contains(&code.len()) && code.chars().all(|c| c.is_ascii_alphanumeric())
}

const COLORS: [&str; 8] = ["#e05a55", "#4f8fd8", "#4fae6f", "#e3b341", "#9a6dd7", "#d667a6", "#e9883c", "#5ec4c4"];

impl AppState {
    /// Load saved rooms from the data folder.
    pub fn load(cfg: Config) -> std::io::Result<Self> {
        std::fs::create_dir_all(cfg.data.join("rooms"))?;
        let mut rooms = HashMap::new();
        for entry in std::fs::read_dir(cfg.data.join("rooms"))? {
            let p = entry?.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let code = p.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
            if !valid_code(&code) {
                continue;
            }
            if let Ok(saved) = std::fs::read(&p).map_err(|_| ()).and_then(|b| serde_json::from_slice::<Saved>(&b).map_err(|_| ())) {
                rooms.insert(code, Room { saved, conns: BTreeMap::new(), requests: BTreeMap::new(), dirty: false });
            }
        }
        Ok(Self(Arc::new(Inner { data: cfg.data, dm_key: cfg.dm_key, rooms: Mutex::new(rooms), next_conn: AtomicU64::new(1) })))
    }

    fn is_dm(&self, key: &str) -> bool {
        // Constant-time compare: the key is the only thing between a stranger and the DM's seat.
        let (a, b) = (self.0.dm_key.as_bytes(), key.as_bytes());
        a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }

    /// Write rooms that changed (called every couple of seconds and on shutdown).
    pub fn save(&self) {
        let dirty: Vec<(String, Vec<u8>)> = {
            let mut rooms = self.0.rooms.lock().unwrap();
            rooms
                .iter_mut()
                .filter(|(_, r)| r.dirty)
                .map(|(code, r)| {
                    r.dirty = false;
                    (code.clone(), serde_json::to_vec(&r.saved).unwrap_or_default())
                })
                .collect()
        };
        for (code, bytes) in dirty {
            let path = self.0.data.join("rooms").join(format!("{code}.json"));
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, &path)).is_err() {
                eprintln!("could not save room {code}");
            }
        }
    }

    fn image_path(&self, code: &str, hash: &str) -> PathBuf {
        self.0.data.join("rooms").join(format!("{code}-{hash}.img"))
    }

    fn category_path(&self, code: &str, cat: &str) -> PathBuf {
        self.0.data.join("rooms").join(format!("{code}-compendium-{cat}.data"))
    }

    fn page_path(&self, code: &str, id: &str) -> PathBuf {
        self.0.data.join("rooms").join(format!("{code}-page-{id}.data"))
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(page))
        .route("/join/{code}", get(page))
        .route("/assets/{file}", get(asset))
        .route("/health", get(|| async { "ok" }))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{code}/image/{hash}", get(image))
        .route("/api/rooms/{code}/compendium", get(compendium_meta).put(publish_compendium).delete(remove_compendium))
        .route(
            "/api/rooms/{code}/compendium/{cat}",
            get(compendium_category).put(put_category).layer(DefaultBodyLimit::max(MAX_CATEGORY)),
        )
        .route("/api/rooms/{code}/journal", get(journal_list))
        .route(
            "/api/rooms/{code}/journal/{id}",
            get(journal_page).put(put_page).delete(remove_page).layer(DefaultBodyLimit::max(MAX_PAGE)),
        )
        .route("/ws/{code}", get(ws))
        .layer(DefaultBodyLimit::max(64 << 10))
        // BrainWaves (another origin: the desktop app, or its dev page) makes rooms here. Every
        // DM call needs the DM key anyway, so any origin may ask.
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::PUT, axum::http::Method::DELETE])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        )
        .with_state(state)
}

// ---------------------------------------------------------------- http

async fn page() -> Html<&'static str> {
    Html(include_str!("../../../apps/table/index.html"))
}

async fn asset(Path(file): Path<String>) -> Response {
    let (body, mime): (&'static [u8], &str) = match file.as_str() {
        "table.js" => (include_bytes!("../../../apps/table/table.js"), "text/javascript; charset=utf-8"),
        "characters.js" => (include_bytes!("../../../apps/table/characters.js"), "text/javascript; charset=utf-8"),
        "hub.js" => (include_bytes!("../../../apps/table/hub.js"), "text/javascript; charset=utf-8"),
        "table.css" => (include_bytes!("../../../apps/table/table.css"), "text/css; charset=utf-8"),
        "cinzel-500.woff2" => (include_bytes!("../../../apps/table/fonts/cinzel-latin-500-normal.woff2"), "font/woff2"),
        "cinzel-700.woff2" => (include_bytes!("../../../apps/table/fonts/cinzel-latin-700-normal.woff2"), "font/woff2"),
        "garamond-400.woff2" => (include_bytes!("../../../apps/table/fonts/eb-garamond-latin-400-normal.woff2"), "font/woff2"),
        "garamond-400i.woff2" => (include_bytes!("../../../apps/table/fonts/eb-garamond-latin-400-italic.woff2"), "font/woff2"),
        "garamond-600.woff2" => (include_bytes!("../../../apps/table/fonts/eb-garamond-latin-600-normal.woff2"), "font/woff2"),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "public, max-age=3600")], body).into_response()
}

fn bearer(headers: &HeaderMap) -> String {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_string()
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct NewRoom {
    name: String,
    /// Reuse this code (a scene that already had a room).
    code: Option<String>,
}

/// The DM makes (or re-opens) a room for a scene.
async fn create_room(State(s): State<AppState>, headers: HeaderMap, Json(body): Json<NewRoom>) -> Response {
    if !s.is_dm(&bearer(&headers)) {
        return (StatusCode::UNAUTHORIZED, "wrong DM key").into_response();
    }
    let mut rooms = s.0.rooms.lock().unwrap();
    let code = match body.code.filter(|c| valid_code(c)) {
        Some(c) => c,
        None => loop {
            let c: String = rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric).take(10).map(char::from).collect();
            if !rooms.contains_key(&c) {
                break c;
            }
        },
    };
    let room = rooms.entry(code.clone()).or_insert_with(|| Room {
        saved: Saved { scene: json!({}), ..Default::default() },
        conns: BTreeMap::new(),
        requests: BTreeMap::new(),
        dirty: true,
    });
    if !body.name.trim().is_empty() {
        room.saved.name = body.name.trim().chars().take(120).collect();
        room.dirty = true;
    }
    Json(json!({ "code": code })).into_response()
}

async fn image(State(s): State<AppState>, Path((code, hash)): Path<(String, String)>) -> Response {
    if !valid_code(&code) || !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() > 64 {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mime = {
        let rooms = s.0.rooms.lock().unwrap();
        rooms.get(&code).and_then(|r| r.saved.images.iter().find(|(h, _)| *h == hash).map(|(_, m)| m.clone()))
    };
    let Some(mime) = mime else { return StatusCode::NOT_FOUND.into_response() };
    match tokio::fs::read(s.image_path(&code, &hash)).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "public, max-age=31536000, immutable".to_string())], bytes).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ---------------------------------------------------------------- the hub: compendium and journal

fn valid_page_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The DM's key, and a room that exists.
fn dm_room(s: &AppState, headers: &HeaderMap, code: &str) -> Result<(), Response> {
    if !s.is_dm(&bearer(headers)) {
        return Err((StatusCode::UNAUTHORIZED, "wrong DM key").into_response());
    }
    if !valid_code(code) || !s.0.rooms.lock().unwrap().contains_key(code) {
        return Err((StatusCode::NOT_FOUND, "no such table").into_response());
    }
    Ok(())
}

fn room_exists(s: &AppState, code: &str) -> bool {
    valid_code(code) && s.0.rooms.lock().unwrap().contains_key(code)
}

async fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, path).await
}

/// One category of the compendium (a JSON array of 5etools entries), replacing what was there.
async fn put_category(State(s): State<AppState>, headers: HeaderMap, Path((code, cat)): Path<(String, String)>, body: axum::body::Bytes) -> Response {
    if let Err(r) = dm_room(&s, &headers, &code) {
        return r;
    }
    if !CATEGORIES.contains(&cat.as_str()) {
        return (StatusCode::BAD_REQUEST, "players only get spells, items, races, classes, backgrounds, feats and conditions").into_response();
    }
    let count = match serde_json::from_slice::<Vec<serde::de::IgnoredAny>>(&body) {
        Ok(list) => list.len(),
        Err(_) => return (StatusCode::BAD_REQUEST, "not a JSON list").into_response(),
    };
    if write_atomic(&s.category_path(&code, &cat), &body).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "could not save it").into_response();
    }
    let mut rooms = s.0.rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(&code) {
        if !room.saved.compendium.is_object() {
            room.saved.compendium = json!({});
        }
        room.saved.compendium["counts"][&cat] = json!(count);
        room.dirty = true;
    }
    Json(json!({ "category": cat, "count": count })).into_response()
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct PublishCompendium {
    /// The books it was made from (shown to players).
    sources: Vec<String>,
    /// The categories sent this time; others are removed.
    categories: Vec<String>,
}

/// Mark the compendium published (after its categories were sent) and tell the players.
async fn publish_compendium(State(s): State<AppState>, headers: HeaderMap, Path(code): Path<String>, Json(body): Json<PublishCompendium>) -> Response {
    if let Err(r) = dm_room(&s, &headers, &code) {
        return r;
    }
    let stale: Vec<&str> = CATEGORIES.iter().copied().filter(|c| !body.categories.iter().any(|x| x == c)).collect();
    for cat in &stale {
        let _ = tokio::fs::remove_file(s.category_path(&code, cat)).await;
    }
    let mut rooms = s.0.rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(&code) else { return StatusCode::NOT_FOUND.into_response() };
    let mut counts = room.saved.compendium["counts"].as_object().cloned().unwrap_or_default();
    counts.retain(|k, _| !stale.contains(&k.as_str()));
    room.saved.compendium = json!({
        "publishedAt": now_ms(),
        "sources": body.sources.iter().take(400).map(|x| x.chars().take(64).collect::<String>()).collect::<Vec<_>>(),
        "counts": counts,
    });
    room.dirty = true;
    send_all(room, &json!({ "t": "compendium", "compendium": room.saved.compendium }), |_| true);
    Json(room.saved.compendium.clone()).into_response()
}

async fn remove_compendium(State(s): State<AppState>, headers: HeaderMap, Path(code): Path<String>) -> Response {
    if let Err(r) = dm_room(&s, &headers, &code) {
        return r;
    }
    for cat in CATEGORIES {
        let _ = tokio::fs::remove_file(s.category_path(&code, cat)).await;
    }
    let mut rooms = s.0.rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(&code) {
        room.saved.compendium = Value::Null;
        room.dirty = true;
        send_all(room, &json!({ "t": "compendium", "compendium": Value::Null }), |_| true);
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn compendium_meta(State(s): State<AppState>, Path(code): Path<String>) -> Response {
    let rooms = s.0.rooms.lock().unwrap();
    match rooms.get(&code).filter(|_| valid_code(&code)) {
        Some(r) => Json(r.saved.compendium.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn compendium_category(State(s): State<AppState>, Path((code, cat)): Path<(String, String)>) -> Response {
    if !room_exists(&s, &code) || !CATEGORIES.contains(&cat.as_str()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(s.category_path(&code, &cat)).await {
        // The page asks with ?v=<publishedAt>, so a new publication is a new URL.
        Ok(bytes) => ([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "public, max-age=86400")], bytes).into_response(),
        Err(_) => (StatusCode::OK, [(header::CONTENT_TYPE, "application/json")], "[]").into_response(),
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct NewPage {
    title: String,
    icon: String,
    /// log (an expedition log), story (the story so far), or page (anything else).
    kind: String,
    /// The page as HTML (made by BrainWaves; the player page sanitizes it again).
    html: String,
}

/// Publish (or update) a journal page.
async fn put_page(State(s): State<AppState>, headers: HeaderMap, Path((code, id)): Path<(String, String)>, Json(body): Json<NewPage>) -> Response {
    if let Err(r) = dm_room(&s, &headers, &code) {
        return r;
    }
    if !valid_page_id(&id) {
        return (StatusCode::BAD_REQUEST, "bad page id").into_response();
    }
    let kind = match body.kind.as_str() {
        "log" | "story" => body.kind.clone(),
        _ => "page".to_string(),
    };
    let title: String = body.title.trim().chars().take(200).collect();
    let icon: String = body.icon.chars().take(8).collect();
    let now = now_ms();
    {
        let rooms = s.0.rooms.lock().unwrap();
        let room = rooms.get(&code).unwrap();
        if room.saved.journal.len() >= MAX_JOURNAL && !room.saved.journal.iter().any(|p| p["id"] == json!(id)) {
            return (StatusCode::INSUFFICIENT_STORAGE, "the journal is full").into_response();
        }
    }
    if write_atomic(&s.page_path(&code, &id), body.html.as_bytes()).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "could not save it").into_response();
    }
    let mut rooms = s.0.rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(&code) else { return StatusCode::NOT_FOUND.into_response() };
    let entry = match room.saved.journal.iter_mut().find(|p| p["id"] == json!(id)) {
        Some(p) => {
            p["title"] = json!(title);
            p["icon"] = json!(icon);
            p["kind"] = json!(kind);
            p["updated"] = json!(now);
            p.clone()
        }
        None => {
            let p = json!({ "id": id, "title": title, "icon": icon, "kind": kind, "published": now, "updated": now });
            room.saved.journal.push(p.clone());
            p
        }
    };
    room.dirty = true;
    send_all(room, &json!({ "t": "journal", "journal": room.saved.journal }), |_| true);
    Json(entry).into_response()
}

async fn remove_page(State(s): State<AppState>, headers: HeaderMap, Path((code, id)): Path<(String, String)>) -> Response {
    if let Err(r) = dm_room(&s, &headers, &code) {
        return r;
    }
    if !valid_page_id(&id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let _ = tokio::fs::remove_file(s.page_path(&code, &id)).await;
    let mut rooms = s.0.rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(&code) {
        room.saved.journal.retain(|p| p["id"] != json!(id));
        room.dirty = true;
        send_all(room, &json!({ "t": "journal", "journal": room.saved.journal }), |_| true);
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn journal_list(State(s): State<AppState>, Path(code): Path<String>) -> Response {
    let rooms = s.0.rooms.lock().unwrap();
    match rooms.get(&code).filter(|_| valid_code(&code)) {
        Some(r) => Json(r.saved.journal.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn journal_page(State(s): State<AppState>, Path((code, id)): Path<(String, String)>) -> Response {
    let meta = {
        let rooms = s.0.rooms.lock().unwrap();
        rooms.get(&code).filter(|_| valid_code(&code)).and_then(|r| r.saved.journal.iter().find(|p| p["id"] == json!(id)).cloned())
    };
    let Some(mut meta) = meta.filter(|_| valid_page_id(&id)) else { return StatusCode::NOT_FOUND.into_response() };
    let html = tokio::fs::read_to_string(s.page_path(&code, &id)).await.unwrap_or_default();
    meta["html"] = json!(html);
    ([(header::CACHE_CONTROL, "no-cache")], Json(meta)).into_response()
}

// ---------------------------------------------------------------- live

#[derive(Deserialize, Default)]
#[serde(default)]
struct Join {
    key: String,
    name: String,
    pid: String,
}

async fn ws(State(s): State<AppState>, Path(code): Path<String>, Query(q): Query<Join>, up: WebSocketUpgrade) -> Response {
    if !valid_code(&code) || !s.0.rooms.lock().unwrap().contains_key(&code) {
        return (StatusCode::NOT_FOUND, "no such table").into_response();
    }
    let dm = !q.key.is_empty() && s.is_dm(&q.key);
    if !q.key.is_empty() && !dm {
        return (StatusCode::UNAUTHORIZED, "wrong DM key").into_response();
    }
    let name: String = if dm { "Dungeon Master".into() } else { q.name.trim().chars().take(40).collect() };
    let name = if name.is_empty() { "Adventurer".to_string() } else { name };
    let pid = (!dm && valid_pid(&q.pid)).then(|| q.pid.clone());
    up.max_message_size(if dm { MAX_IMAGE + (4 << 20) } else { MAX_PLAYER_MSG })
        .on_upgrade(move |socket| session(s, code, dm, pid, name, socket))
}

async fn session(s: AppState, code: String, dm: bool, pid: Option<String>, name: String, socket: WebSocket) {
    let id = s.0.next_conn.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(Message::Text(m.into())).await.is_err() {
                break;
            }
        }
    });

    {
        let mut rooms = s.0.rooms.lock().unwrap();
        let Some(room) = rooms.get_mut(&code) else { return };
        let color = COLORS[(id as usize) % COLORS.len()].to_string();
        room.conns.insert(id, Conn { dm, pid: pid.clone(), name: name.clone(), claim: None, color: color.clone(), tx: tx.clone(), window: (0, 0) });
        let welcome = json!({
            "t": "welcome",
            "you": { "id": id, "dm": dm, "name": name, "color": color },
            "room": { "code": code, "name": room.saved.name },
            "scene": room.saved.scene,
            "rolls": room.saved.rolls,
            "requests": if dm { room.requests.values().cloned().collect::<Vec<_>>() } else { vec![] },
            "dmOnline": room.conns.values().any(|c| c.dm),
            "rules": room.saved.rules,
            "party": party_for(room, dm, pid.as_deref()),
            "compendium": room.saved.compendium,
            "journal": room.saved.journal,
            "submissions": if dm { open_submissions(room) } else { mine(room, pid.as_deref()) },
        });
        let _ = tx.send(welcome.to_string());
        broadcast_players(room);
        if dm {
            send_all(room, &json!({ "t": "dm", "online": true }), |_| true);
        }
    }

    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        handle(&s, &code, id, v);
    }

    writer.abort();
    let mut rooms = s.0.rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(&code) {
        let was_dm = room.conns.remove(&id).is_some_and(|c| c.dm);
        // A player who leaves takes their open requests with them.
        let gone: Vec<String> = room.requests.iter().filter(|(_, r)| r["from"] == json!(id)).map(|(k, _)| k.clone()).collect();
        for k in gone {
            room.requests.remove(&k);
            send_all(room, &json!({ "t": "decided", "id": k, "accept": false, "withdrawn": true }), |c| c.dm);
        }
        broadcast_players(room);
        if was_dm && !room.conns.values().any(|c| c.dm) {
            send_all(room, &json!({ "t": "dm", "online": false }), |_| true);
        }
    }
}

fn send_all(room: &Room, msg: &Value, to: impl Fn(&Conn) -> bool) {
    let text = msg.to_string();
    for c in room.conns.values().filter(|c| to(c)) {
        let _ = c.tx.send(text.clone());
    }
}

fn broadcast_players(room: &Room) {
    let players: Vec<Value> = room
        .conns
        .iter()
        .filter(|(_, c)| !c.dm)
        .map(|(id, c)| json!({ "id": id, "name": c.name, "claim": c.claim, "color": c.color }))
        .collect();
    send_all(room, &json!({ "t": "players", "players": players }), |_| true);
}

/// The party as one connection sees it. A player gets only their own characters (marked
/// `mine`); the DM gets everyone. Pids stay here.
fn party_for(room: &Room, dm: bool, pid: Option<&str>) -> Vec<Value> {
    room.saved
        .party
        .iter()
        .filter_map(|c| {
            let owner = c["id"].as_str().and_then(|id| room.saved.owners.get(id));
            let mine = pid.is_some() && owner.map(String::as_str) == pid;
            if !dm && !mine {
                return None;
            }
            let mut c = c.clone();
            c["mine"] = json!(mine);
            Some(c)
        })
        .collect()
}

fn send_party(room: &Room) {
    for c in room.conns.values() {
        let msg = json!({ "t": "party", "party": party_for(room, c.dm, if c.dm { None } else { c.pid.as_deref() }) });
        let _ = c.tx.send(msg.to_string());
    }
}

/// A submission without the player's browser id.
fn public(sub: &Value) -> Value {
    let mut s = sub.clone();
    if let Some(o) = s.as_object_mut() {
        o.remove("pid");
    }
    s
}

/// One player's submissions.
fn mine(room: &Room, pid: Option<&str>) -> Vec<Value> {
    let Some(pid) = pid else { return vec![] };
    room.saved.submissions.iter().filter(|s| s["pid"] == json!(pid)).map(public).collect()
}

/// What waits for the DM.
fn open_submissions(room: &Room) -> Vec<Value> {
    room.saved.submissions.iter().filter(|s| s["status"] == json!("pending")).map(public).collect()
}

fn send_mine(room: &Room, pid: &str) {
    let msg = json!({ "t": "submissions", "submissions": mine(room, Some(pid)) }).to_string();
    for c in room.conns.values().filter(|c| c.pid.as_deref() == Some(pid)) {
        let _ = c.tx.send(msg.clone());
    }
}

/// Tokens players may claim and move: visible ones the DM marked as player characters.
fn player_tokens(scene: &Value) -> Vec<String> {
    scene["tokens"]
        .as_array()
        .map(|ts| ts.iter().filter(|t| t["player"] == json!(true)).filter_map(|t| t["id"].as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn point(v: &Value, k: &str) -> Option<f64> {
    v[k].as_f64().filter(|n| n.is_finite() && n.abs() < 1e7)
}

fn handle(s: &AppState, code: &str, id: u64, v: Value) {
    let mut rooms = s.0.rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(code) else { return };
    let Some(conn) = room.conns.get_mut(&id) else { return };
    let dm = conn.dm;

    // Players get 20 messages a second; enough to draw, not enough to flood.
    if !dm {
        let sec = now_ms() / 1000;
        if conn.window.0 != sec {
            conn.window = (sec, 0);
        }
        conn.window.1 += 1;
        if conn.window.1 > 20 {
            return;
        }
    }
    let (name, color) = (conn.name.clone(), conn.color.clone());
    let reply = |room: &Room, msg: Value| {
        if let Some(c) = room.conns.get(&id) {
            let _ = c.tx.send(msg.to_string());
        }
    };
    let t = v["t"].as_str().unwrap_or_default();

    match (dm, t) {
        // ---- the DM
        (true, "scene") => {
            let scene = v["scene"].clone();
            if !scene.is_object() || scene.to_string().len() > MAX_SCENE {
                return reply(room, json!({ "t": "error", "message": "scene too large or not an object" }));
            }
            room.saved.scene = scene.clone();
            room.dirty = true;
            // Claims on tokens that are gone or hidden now are dropped.
            let allowed = player_tokens(&scene);
            for c in room.conns.values_mut() {
                if c.claim.as_ref().is_some_and(|t| !allowed.contains(t)) {
                    c.claim = None;
                }
            }
            send_all(room, &json!({ "t": "scene", "scene": scene }), |c| !c.dm);
            broadcast_players(room);
        }
        (true, "image") => {
            let (Some(hash), Some(data)) = (v["hash"].as_str(), v["data"].as_str()) else { return };
            if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.is_empty() || hash.len() > 64 {
                return;
            }
            let Some((meta, b64)) = data.strip_prefix("data:").and_then(|d| d.split_once(";base64,")) else {
                return reply(room, json!({ "t": "error", "message": "the picture must be a base64 data URL" }));
            };
            if !meta.starts_with("image/") || b64.len() > MAX_IMAGE * 4 / 3 + 4 {
                return reply(room, json!({ "t": "error", "message": "not an image, or too large" }));
            }
            let Ok(bytes) = B64.decode(b64) else { return };
            if std::fs::write(s.image_path(code, hash), &bytes).is_err() {
                return reply(room, json!({ "t": "error", "message": "could not store the picture" }));
            }
            room.saved.images.retain(|(h, _)| h != hash);
            room.saved.images.push((hash.to_string(), meta.to_string()));
            while room.saved.images.len() > KEEP_IMAGES {
                let (old, _) = room.saved.images.remove(0);
                let _ = std::fs::remove_file(s.image_path(code, &old));
            }
            room.dirty = true;
            reply(room, json!({ "t": "imageStored", "hash": hash }));
        }
        (true, "rules") => {
            let rules = v["rules"].clone();
            if !(rules.is_object() || rules.is_null()) || rules.to_string().len() > MAX_RULES {
                return reply(room, json!({ "t": "error", "message": "rules too large or not an object" }));
            }
            room.saved.rules = rules.clone();
            room.dirty = true;
            send_all(room, &json!({ "t": "rules", "rules": rules }), |c| !c.dm);
        }
        (true, "party") => {
            let Some(party) = v["party"].as_array() else { return };
            if v["party"].to_string().len() > MAX_PARTY {
                return reply(room, json!({ "t": "error", "message": "party too large" }));
            }
            room.saved.party = party.iter().filter(|c| c["id"].is_string()).take(100).cloned().collect();
            room.dirty = true;
            send_party(room);
        }
        (true, "review") => {
            let Some(sid) = v["id"].as_str() else { return };
            let approve = v["approve"] == json!(true);
            let note: String = v["note"].as_str().unwrap_or_default().chars().take(2000).collect();
            let character = v["characterId"].as_str().map(String::from);
            let Some(sub) = room.saved.submissions.iter_mut().find(|s| s["id"] == json!(sid)) else { return };
            sub["status"] = json!(if approve { "approved" } else { "returned" });
            sub["note"] = json!(note);
            if let Some(ch) = &character {
                sub["characterId"] = json!(ch);
            }
            let pid = sub["pid"].as_str().unwrap_or_default().to_string();
            let reviewed = public(sub);
            if approve {
                if let Some(ch) = character {
                    room.saved.owners.insert(ch, pid.clone());
                }
            }
            room.dirty = true;
            send_mine(room, &pid);
            send_all(room, &json!({ "t": "reviewed", "submission": reviewed }), |c| c.dm);
            send_party(room);
        }
        (true, "decide") => {
            let Some(rid) = v["id"].as_str() else { return };
            if let Some(req) = room.requests.remove(rid) {
                let msg = json!({ "t": "decided", "id": rid, "accept": v["accept"] == json!(true), "token": req["token"] });
                send_all(room, &msg, |_| true);
            }
        }
        (true, "ping") | (false, "ping") => {
            let (Some(x), Some(y)) = (point(&v, "x"), point(&v, "y")) else { return };
            send_all(room, &json!({ "t": "ping", "from": id, "name": name, "color": color, "x": x, "y": y }), |_| true);
        }
        (_, "draw") => {
            let Some(points) = v["points"].as_array() else { return };
            let pts: Vec<[f64; 2]> = points
                .iter()
                .take(1000)
                .filter_map(|p| Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?]))
                .filter(|p| p[0].is_finite() && p[1].is_finite())
                .collect();
            if pts.len() < 2 {
                return;
            }
            let draw_id = format!("{id}-{}", now_ms());
            let until = now_ms() + DRAWING_SECONDS * 1000;
            send_all(room, &json!({ "t": "draw", "id": draw_id, "from": id, "name": name, "color": color, "points": pts, "until": until }), |_| true);
        }
        (_, "roll") => {
            let expr = v["expr"].as_str().unwrap_or("d20");
            let label: String = v["label"].as_str().unwrap_or_default().chars().take(60).collect();
            match dice::roll(expr, &mut rand::thread_rng()) {
                Ok(r) => {
                    let private = dm && v["private"] == json!(true);
                    let msg = json!({ "t": "roll", "from": id, "name": name, "color": color, "expr": r.expr, "detail": r.detail, "total": r.total, "label": label, "at": now_ms(), "private": private });
                    if private {
                        send_all(room, &msg, |c| c.dm);
                    } else {
                        room.saved.rolls.push_back(msg.clone());
                        while room.saved.rolls.len() > KEEP_ROLLS {
                            room.saved.rolls.pop_front();
                        }
                        room.dirty = true;
                        send_all(room, &msg, |_| true);
                    }
                }
                Err(e) => reply(room, json!({ "t": "error", "message": e })),
            }
        }
        // ---- players
        (false, "submit") => {
            let Some(pid) = room.conns.get(&id).and_then(|c| c.pid.clone()) else {
                return reply(room, json!({ "t": "error", "message": "Reload the page to build characters." }));
            };
            let character = v["character"].clone();
            if !character.is_object() || character.to_string().len() > MAX_CHARACTER {
                return reply(room, json!({ "t": "error", "message": "That character is too large." }));
            }
            let name = character["name"].as_str().unwrap_or_default().trim().to_string();
            if name.is_empty() {
                return reply(room, json!({ "t": "error", "message": "Give your character a name." }));
            }
            // Editing a submission that was sent back (or still waits) replaces it.
            let existing = v["id"].as_str().and_then(|sid| {
                room.saved.submissions.iter().position(|s| s["id"] == json!(sid) && s["pid"] == json!(pid) && s["status"] != json!("approved"))
            });
            let open = room.saved.submissions.iter().filter(|s| s["pid"] == json!(pid) && s["status"] != json!("approved")).count();
            if existing.is_none() && open >= MAX_OPEN_SUBMISSIONS {
                return reply(room, json!({ "t": "error", "message": "You have several characters waiting already; wait for the DM." }));
            }
            let sid = match existing {
                Some(i) => room.saved.submissions[i]["id"].as_str().unwrap_or_default().to_string(),
                None => format!("c{}{}", now_ms(), rand::thread_rng().gen_range(100..999)),
            };
            let sub = json!({ "id": sid, "pid": pid, "player": name_of(room, id), "character": character, "status": "pending", "note": "", "at": now_ms() });
            match existing {
                Some(i) => room.saved.submissions[i] = sub.clone(),
                None => room.saved.submissions.push(sub.clone()),
            }
            while room.saved.submissions.len() > KEEP_SUBMISSIONS {
                // Forget the oldest settled ones first.
                let Some(i) = room.saved.submissions.iter().position(|s| s["status"] != json!("pending")) else { break };
                room.saved.submissions.remove(i);
            }
            room.dirty = true;
            send_mine(room, &pid);
            send_all(room, &json!({ "t": "submission", "submission": public(&sub) }), |c| c.dm);
        }
        (false, "withdraw") => {
            let (Some(pid), Some(sid)) = (room.conns.get(&id).and_then(|c| c.pid.clone()), v["id"].as_str()) else { return };
            let before = room.saved.submissions.len();
            room.saved.submissions.retain(|s| !(s["id"] == json!(sid) && s["pid"] == json!(pid) && s["status"] != json!("approved")));
            if room.saved.submissions.len() != before {
                room.dirty = true;
                send_mine(room, &pid);
                send_all(room, &json!({ "t": "withdrawn", "id": sid }), |c| c.dm);
            }
        }
        (false, "claim") => {
            let token = v["token"].as_str().map(String::from);
            if token.as_ref().is_some_and(|t| !player_tokens(&room.saved.scene).contains(t)) {
                return reply(room, json!({ "t": "error", "message": "that token isn't a player character" }));
            }
            if let Some(c) = room.conns.get_mut(&id) {
                c.claim = token;
            }
            broadcast_players(room);
        }
        (false, "move") => {
            let claim = room.conns.get(&id).and_then(|c| c.claim.clone());
            let (Some(token), Some(x), Some(y)) = (v["token"].as_str(), point(&v, "x"), point(&v, "y")) else { return };
            if claim.as_deref() != Some(token) {
                return reply(room, json!({ "t": "error", "message": "choose your character first; you can only move your own" }));
            }
            // One open request per player: a new one replaces the last.
            let old: Vec<String> = room.requests.iter().filter(|(_, r)| r["from"] == json!(id)).map(|(k, _)| k.clone()).collect();
            for k in old {
                room.requests.remove(&k);
                send_all(room, &json!({ "t": "decided", "id": k, "accept": false, "withdrawn": true }), |_| true);
            }
            let rid = format!("{id}-{}", now_ms());
            let req = json!({ "t": "request", "id": rid, "from": id, "name": name, "color": color, "token": token, "x": x, "y": y });
            room.requests.insert(rid.clone(), req.clone());
            send_all(room, &req, |c| c.dm);
            reply(room, json!({ "t": "pending", "id": rid, "token": token, "x": x, "y": y }));
            if !room.conns.values().any(|c| c.dm) {
                reply(room, json!({ "t": "error", "message": "The DM isn't connected right now; your request waits for them." }));
            }
        }
        _ => {}
    }
}

fn name_of(room: &Room, id: u64) -> String {
    room.conns.get(&id).map(|c| c.name.clone()).unwrap_or_default()
}

/// Save changed rooms every two seconds, for as long as the server runs.
pub fn spawn_saver(s: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(2));
        loop {
            tick.tick().await;
            let s2 = s.clone();
            let _ = tokio::task::spawn_blocking(move || s2.save()).await;
        }
    });
}
