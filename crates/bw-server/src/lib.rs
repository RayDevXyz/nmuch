//! BrainWaves as a hosted web app (for a VPS): the core, the same API the desktop app uses, a
//! login, and the web app itself, from one address.
//!
//! - `POST /api/<command>` runs `bw_api::dispatch` (like the desktop app's `core_call`).
//! - `GET /api/events` streams the core's events (Server-Sent Events).
//! - `/api/auth/*`: the owner's account, sessions and API tokens (see `auth.rs`).
//! - Everything else serves the built web app (`WEB_DIR`), with `index.html` for app routes.
//!
//! Every API call needs the owner's session cookie or an API token (`Authorization: Bearer …`).
//! The first account made becomes the owner; after that nobody else can sign up.
//!
//! Settings (environment): `PORT` (8080), `DATA_DIR` (`./data`), `WEB_DIR` (`./web`),
//! `TRUST_PROXY` (`true` behind an HTTPS reverse proxy: secure cookies, client address from
//! `X-Forwarded-For`).

pub mod auth;

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::services::{ServeDir, ServeFile};

use auth::{Auth, SESSION_DAYS};

const COOKIE: &str = "bw_session";

#[derive(Clone)]
pub struct AppState {
    core: Arc<Mutex<bw_core::Core>>,
    ctx: Arc<bw_api::Context>,
    events: broadcast::Sender<String>,
    auth: Arc<Mutex<Auth>>,
    trust_proxy: bool,
}

pub struct Config {
    pub data: PathBuf,
    pub web: PathBuf,
    pub trust_proxy: bool,
}

/// Open the workspace and build the app (also used by the tests).
pub fn app(cfg: Config) -> Router {
    std::fs::create_dir_all(&cfg.data).expect("create the data folder");
    let db = cfg.data.join("brainwaves.db");
    let mut core = bw_core::Core::open(&db).expect("open the workspace");
    let rx = core.subscribe();
    let (tx, _) = broadcast::channel::<String>(256);
    let forward = tx.clone();
    std::thread::spawn(move || {
        for event in rx {
            if let Ok(json) = serde_json::to_string(&event) {
                let _ = forward.send(json);
            }
        }
    });
    let core = Arc::new(Mutex::new(core));
    bw_api::watch::spawn(core.clone());
    let state = AppState {
        core,
        // A server never opens files in desktop apps.
        ctx: Arc::new(bw_api::Context { nimbus_db: None, open_files: false }),
        events: tx,
        auth: Arc::new(Mutex::new(Auth::load(cfg.data.join("auth.json")))),
        trust_proxy: cfg.trust_proxy,
    };

    let index = cfg.web.join("index.html");
    let web = ServeDir::new(&cfg.web).not_found_service(ServeFile::new(index));
    let api = Router::new()
        .route("/events", get(events))
        .route("/{command}", post(call))
        .route("/auth/password", post(change_password))
        .route("/auth/tokens", get(list_tokens).post(create_token))
        .route("/auth/tokens/{id}", delete(delete_token))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_login))
        .route("/auth/state", get(auth_state))
        .route("/auth/setup", post(setup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout));

    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .nest("/api", api)
        .fallback_service(web)
        // Pages can hold large pictures (canvas images, battle maps).
        .layer(DefaultBodyLimit::max(80 << 20))
        .layer(middleware::from_fn(security_headers))
        .with_state(state)
}

/// Run the server with settings from the environment (see the crate docs).
pub async fn run() {

    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    let port: u16 = env("PORT").and_then(|p| p.parse().ok()).unwrap_or(8080);
    let cfg = Config {
        data: env("DATA_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("data")),
        web: env("WEB_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("web")),
        trust_proxy: env("TRUST_PROXY").is_some_and(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes")),
    };
    if !cfg.web.join("index.html").exists() {
        eprintln!("warning: no web app in {} (set WEB_DIR to the built apps/desktop/dist)", cfg.web.display());
    }
    println!("BrainWaves on http://0.0.0.0:{port}  (data: {}, web: {})", cfg.data.display(), cfg.web.display());
    let app = app(cfg);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await.expect("bind");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
}

// ---------------------------------------------------------------- the API

async fn call(State(s): State<AppState>, Path(command): Path<String>, body: Option<Json<Value>>) -> Result<Json<Value>, (StatusCode, String)> {
    let args = body.map(|Json(v)| v).filter(|v| !v.is_null()).unwrap_or_else(|| Value::Object(Default::default()));
    let (core, ctx) = (s.core.clone(), s.ctx.clone());
    tokio::task::spawn_blocking(move || {
        // Slow host work (5etools, Burrow) runs without holding the core.
        if let Some(r) = bw_api::dispatch_unlocked(&core, &command, &args) {
            return r;
        }
        let mut core = core.lock().map_err(|e| e.to_string())?;
        bw_api::dispatch(&mut core, &ctx, &command, args)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map(Json)
    .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

async fn events(State(s): State<AppState>) -> impl IntoResponse {
    let stream = BroadcastStream::new(s.events.subscribe()).filter_map(|m| m.ok()).map(|json| Ok::<_, Infallible>(SseEvent::default().data(json)));
    // Reverse proxies (Cosmos, nginx, Traefik) may buffer or compress a response until it ends,
    // which holds every event back: ask them not to. A first comment makes them pass it on now.
    let hello = tokio_stream::once(Ok::<_, Infallible>(SseEvent::default().comment("connected")));
    (
        [
            (header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-transform")),
            (HeaderName::from_static("x-accel-buffering"), HeaderValue::from_static("no")),
        ],
        Sse::new(hello.chain(stream)).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15))),
    )
}

// ---------------------------------------------------------------- who's asking

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|kv| {
        let (k, v) = kv.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ").map(|t| t.trim().to_string())
}

#[derive(Clone, Copy, PartialEq)]
enum Who {
    /// The owner, in their browser.
    Session,
    /// Another app, with an API token.
    Token,
}

fn who(s: &AppState, headers: &HeaderMap) -> Option<Who> {
    let mut auth = s.auth.lock().ok()?;
    if cookie(headers, COOKIE).is_some_and(|c| auth.session_ok(&c)) {
        return Some(Who::Session);
    }
    if bearer(headers).is_some_and(|t| auth.token_ok(&t)) {
        return Some(Who::Token);
    }
    None
}

async fn require_login(State(s): State<AppState>, mut req: Request, next: Next) -> Response {
    match who(&s, req.headers()) {
        Some(w) => {
            // Account settings are for the owner's own browser, not for tokens.
            if w == Who::Token && (req.uri().path().starts_with("/auth/") || req.uri().path().starts_with("/api/auth/")) {
                return (StatusCode::FORBIDDEN, "API tokens can't manage the account").into_response();
            }
            req.extensions_mut().insert(w);
            next.run(req).await
        }
        None => (StatusCode::UNAUTHORIZED, "Sign in to BrainWaves").into_response(),
    }
}

fn client(s: &AppState, headers: &HeaderMap, addr: Option<SocketAddr>) -> String {
    if s.trust_proxy {
        if let Some(f) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()) {
            return f.trim().to_string();
        }
    }
    addr.map(|a| a.ip().to_string()).unwrap_or_else(|| "unknown".into())
}

fn session_cookie(s: &AppState, token: &str, max_age: u64) -> HeaderValue {
    let secure = if s.trust_proxy { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{secure}")).expect("cookie")
}

// ---------------------------------------------------------------- account

async fn auth_state(State(s): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let signed_in = who(&s, &headers) == Some(Who::Session);
    let auth = s.auth.lock().unwrap();
    Json(json!({ "hosted": true, "hasOwner": auth.has_owner(), "user": if signed_in { auth.owner_name() } else { None } }))
}

#[derive(Deserialize)]
struct Credentials {
    #[serde(default)]
    name: String,
    password: String,
}

fn signed_in(s: &AppState, token: String) -> Response {
    let mut r = Json(json!({ "ok": true })).into_response();
    r.headers_mut().insert(header::SET_COOKIE, session_cookie(s, &token, SESSION_DAYS * 86400));
    r
}

async fn setup(State(s): State<AppState>, Json(c): Json<Credentials>) -> Response {
    let r = s.auth.lock().unwrap().setup(&c.name, &c.password);
    match r {
        Ok(token) => signed_in(&s, token),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

async fn login(State(s): State<AppState>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(c): Json<Credentials>) -> Response {
    let who = client(&s, &headers, Some(addr));
    let r = s.auth.lock().unwrap().login(&who, &c.name, &c.password);
    match r {
        Ok(token) => signed_in(&s, token),
        Err(e) => {
            // Slow down guessing a little more.
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            (StatusCode::UNAUTHORIZED, e).into_response()
        }
    }
}

async fn logout(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(c) = cookie(&headers, COOKIE) {
        s.auth.lock().unwrap().logout(&c);
    }
    let mut r = Json(json!({ "ok": true })).into_response();
    r.headers_mut().insert(header::SET_COOKIE, session_cookie(&s, "", 0));
    r
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewPassword {
    current: String,
    password: String,
}

async fn change_password(State(s): State<AppState>, Json(p): Json<NewPassword>) -> Response {
    let r = s.auth.lock().unwrap().change_password(&p.current, &p.password);
    match r {
        // Everyone was signed out; sign this browser back in.
        Ok(()) => {
            let token = {
                let mut a = s.auth.lock().unwrap();
                let name = a.owner_name().unwrap_or_default();
                a.login("password-change", &name, &p.password)
            };
            match token {
                Ok(t) => signed_in(&s, t),
                Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
            }
        }
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

async fn list_tokens(State(s): State<AppState>) -> Json<Value> {
    let tokens = s.auth.lock().unwrap().tokens();
    Json(json!(tokens.iter().map(|t| json!({ "id": t.id, "name": t.name, "created": t.created, "lastUsed": t.last_used })).collect::<Vec<_>>()))
}

#[derive(Deserialize)]
struct NewToken {
    name: String,
}

async fn create_token(State(s): State<AppState>, Json(t): Json<NewToken>) -> Response {
    let r = s.auth.lock().unwrap().create_token(&t.name);
    match r {
        Ok((t, secret)) => Json(json!({ "id": t.id, "name": t.name, "token": secret })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

async fn delete_token(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    match s.auth.lock().unwrap().delete_token(&id) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

// ---------------------------------------------------------------- headers

async fn security_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut r = next.run(req).await;
    let h = r.headers_mut();
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("referrer-policy", HeaderValue::from_static("same-origin"));
    h.insert("x-frame-options", HeaderValue::from_static("SAMEORIGIN"));
    // The app shell must never be cached stale; its hashed assets can be.
    if path.starts_with("/assets/") {
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    } else if !path.starts_with("/api/") {
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    r
}
