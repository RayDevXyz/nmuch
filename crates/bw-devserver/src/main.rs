//! Development bridge: the same commands the Tauri app offers, over HTTP.
//!
//!     cargo run -p bw-devserver -- [path/to/workspace.db] [port] [path/to/nimbus.db]
//!
//! The optional third argument is an old Nimbus database to offer for import.
//!
//! - `POST /api/<command>` with a JSON body runs `bw_api::dispatch`.
//! - `GET /api/events` is a Server-Sent Events stream of core events.
//!
//! Vite proxies `/api` here (see `apps/desktop/vite.config.ts`), so `pnpm dev` in a browser
//! behaves like the desktop app. Binds to 127.0.0.1 only.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::Stream;
use serde_json::Value;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

#[derive(Clone)]
struct AppState {
    core: Arc<Mutex<bw_core::Core>>,
    ctx: Arc<bw_api::Context>,
    events: broadcast::Sender<String>,
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let db = args.next().unwrap_or_else(|| "brainwaves-dev.db".into());
    let port: u16 = args.next().and_then(|p| p.parse().ok()).unwrap_or(1430);
    let ctx = bw_api::Context {
        nimbus_db: args.next().map(Into::into),
    };

    let mut core = bw_core::Core::open(&db).expect("open workspace");
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

    let state = AppState {
        core: Arc::new(Mutex::new(core)),
        ctx: Arc::new(ctx),
        events: tx,
    };
    let app = Router::new()
        .route("/api/events", get(events))
        .route("/api/{command}", post(call))
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    println!("bw-devserver: {db} on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

async fn call(
    State(s): State<AppState>,
    Path(command): Path<String>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let args = body.map(|Json(v)| v).unwrap_or(Value::Null);
    let args = if args.is_null() {
        Value::Object(Default::default())
    } else {
        args
    };
    let (core, ctx) = (s.core.clone(), s.ctx.clone());
    tokio::task::spawn_blocking(move || {
        let mut core = core.lock().map_err(|e| e.to_string())?;
        bw_api::dispatch(&mut core, &ctx, &command, args)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map(Json)
    .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

async fn events(
    State(s): State<AppState>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let stream = BroadcastStream::new(s.events.subscribe())
        .filter_map(|m| m.ok())
        .map(|json| Ok(SseEvent::default().data(json)));
    Sse::new(stream).keep_alive(KeepAlive::default())
}
