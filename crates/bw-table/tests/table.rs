//! The table server end to end: a DM and players over real WebSockets.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
const KEY: &str = "test-dm-key-123";

async fn start(data: &std::path::Path) -> (String, bw_table::AppState) {
    let state = bw_table::AppState::load(bw_table::Config { data: data.to_path_buf(), dm_key: KEY.into() }).unwrap();
    let app = bw_table::router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("127.0.0.1:{}", addr.port()), state)
}

fn temp() -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("bw-table-{}", rand_suffix()));
    std::fs::create_dir_all(&d).unwrap();
    d
}
fn rand_suffix() -> String {
    format!("{:?}", std::time::SystemTime::now()).replace(|c: char| !c.is_ascii_alphanumeric(), "")
}

async fn http(addr: &str, method: &str, path: &str, auth: Option<&str>, body: &str) -> (u16, String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut s = TcpStream::connect(addr).await.unwrap();
    let auth = auth.map(|k| format!("Authorization: Bearer {k}\r\n")).unwrap_or_default();
    let req = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    s.write_all(req.as_bytes()).await.unwrap();
    let mut buf = vec![];
    s.read_to_end(&mut buf).await.unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    let code = text.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    (code, body)
}

async fn room(addr: &str) -> String {
    let (code, body) = http(addr, "POST", "/api/rooms", Some(KEY), r#"{"name":"Goblin ambush"}"#).await;
    assert_eq!(code, 200);
    serde_json::from_str::<Value>(&body).unwrap()["code"].as_str().unwrap().to_string()
}

async fn join(addr: &str, room: &str, q: &str) -> Ws {
    connect_async(format!("ws://{addr}/ws/{room}?{q}")).await.unwrap().0
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

/// The next message of type `t` (others are skipped), or None after a short wait.
async fn next(ws: &mut Ws, t: &str) -> Option<Value> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        let m = tokio::time::timeout(left, ws.next()).await.ok()??.ok()?;
        if let Message::Text(text) = m {
            let v: Value = serde_json::from_str(&text).unwrap();
            if v["t"] == t {
                return Some(v);
            }
        }
    }
}

/** The next message of type `t` that also passes `ok`. */
async fn next_where(ws: &mut Ws, t: &str, ok: impl Fn(&Value) -> bool) -> Option<Value> {
    for _ in 0..20 {
        let v = next(ws, t).await?;
        if ok(&v) {
            return Some(v);
        }
    }
    None
}

fn scene() -> Value {
    json!({
        "title": "Goblin ambush",
        "image": null,
        "grid": { "size": 70, "show": true },
        "fog": true,
        "reveals": [{ "x": 0, "y": 0, "w": 700, "h": 490 }],
        "tokens": [
            { "id": "hero", "name": "Maho", "x": 70, "y": 70, "w": 70, "h": 70, "player": true, "hp": 7, "maxHp": 7 },
            { "id": "gob", "name": "Goblin", "x": 280, "y": 70, "w": 70, "h": 70 }
        ]
    })
}

#[tokio::test]
async fn players_see_the_scene_ping_draw_and_ask_the_dm_to_move() {
    let data = temp();
    let (addr, _) = start(&data).await;

    // Only the DM makes rooms; a wrong key gets nowhere.
    assert_eq!(http(&addr, "POST", "/api/rooms", Some("nope"), "{}").await.0, 401);
    assert_eq!(http(&addr, "POST", "/api/rooms", None, "{}").await.0, 401);
    let code = room(&addr).await;
    assert!(connect_async(format!("ws://{addr}/ws/{code}?key=wrong-key")).await.is_err());
    assert!(connect_async(format!("ws://{addr}/ws/doesnotexist?name=x")).await.is_err());

    let mut dm = join(&addr, &code, &format!("key={KEY}")).await;
    assert_eq!(next(&mut dm, "welcome").await.unwrap()["you"]["dm"], json!(true));
    send(&mut dm, json!({ "t": "scene", "scene": scene() })).await;

    let mut ray = join(&addr, &code, "name=Ray").await;
    let w = next(&mut ray, "welcome").await.unwrap();
    assert_eq!((w["you"]["dm"].clone(), w["room"]["name"].clone(), w["dmOnline"].clone()), (json!(false), json!("Goblin ambush"), json!(true)));
    assert_eq!(w["scene"]["tokens"][0]["name"], json!("Maho"));
    let mut sam = join(&addr, &code, "name=Sam").await;
    next(&mut sam, "welcome").await.unwrap();

    // A player can't change the scene.
    send(&mut ray, json!({ "t": "scene", "scene": { "tokens": [] } })).await;
    assert!(next(&mut sam, "scene").await.is_none());

    // Claim: only player tokens; moves only for your own.
    send(&mut ray, json!({ "t": "claim", "token": "gob" })).await;
    assert!(next(&mut ray, "error").await.unwrap()["message"].as_str().unwrap().contains("player character"));
    send(&mut ray, json!({ "t": "move", "token": "hero", "x": 245, "y": 245 })).await;
    assert!(next(&mut ray, "error").await.is_some(), "no claim yet");
    send(&mut ray, json!({ "t": "claim", "token": "hero" })).await;
    let claimed = |v: &Value| v["players"].as_array().unwrap().iter().any(|x| x["name"] == "Ray" && x["claim"] == "hero");
    assert!(next_where(&mut dm, "players", claimed).await.is_some());
    send(&mut sam, json!({ "t": "move", "token": "hero", "x": 1, "y": 1 })).await;
    assert!(next(&mut sam, "error").await.is_some(), "not Sam's character");

    send(&mut ray, json!({ "t": "move", "token": "hero", "x": 245, "y": 245 })).await;
    let req = next(&mut dm, "request").await.unwrap();
    assert_eq!((req["token"].clone(), req["x"].clone(), req["name"].clone()), (json!("hero"), json!(245.0), json!("Ray")));
    let pending = next(&mut ray, "pending").await.unwrap();
    assert!(next(&mut sam, "request").await.is_none(), "requests go to the DM only");
    send(&mut dm, json!({ "t": "decide", "id": req["id"], "accept": true })).await;
    let d = next(&mut ray, "decided").await.unwrap();
    assert_eq!((d["id"].clone(), d["accept"].clone()), (pending["id"].clone(), json!(true)));

    // Pings and drawings reach everyone, the DM included.
    send(&mut sam, json!({ "t": "ping", "x": 300, "y": 200 })).await;
    assert_eq!(next(&mut dm, "ping").await.unwrap()["name"], json!("Sam"));
    assert_eq!(next(&mut ray, "ping").await.unwrap()["x"], json!(300.0));
    send(&mut sam, json!({ "t": "draw", "points": [[0, 0], [50, 50], [100, 0]] })).await;
    let dr = next(&mut dm, "draw").await.unwrap();
    assert_eq!(dr["points"].as_array().unwrap().len(), 3);
    assert!(dr["until"].as_u64().unwrap() > 0);
    send(&mut sam, json!({ "t": "draw", "points": [[0, 0]] })).await;
    assert!(next(&mut dm, "draw").await.is_none(), "a dot isn't a drawing");

    // Dice are rolled here; everyone sees them. A DM's hidden roll stays with the DM.
    send(&mut ray, json!({ "t": "roll", "expr": "2d6+3", "label": "Damage" })).await;
    let r = next(&mut sam, "roll").await.unwrap();
    assert!((5..=15).contains(&r["total"].as_i64().unwrap()));
    assert_eq!((r["name"].clone(), r["label"].clone()), (json!("Ray"), json!("Damage")));
    send(&mut ray, json!({ "t": "roll", "expr": "lots of dice" })).await;
    assert!(next(&mut ray, "error").await.is_some());
    send(&mut dm, json!({ "t": "roll", "expr": "d20", "private": true })).await;
    assert!(next_where(&mut dm, "roll", |v| v["private"] == json!(true)).await.is_some());
    assert!(next(&mut sam, "roll").await.is_none());

    // When the DM hides Ray's token, Ray's claim goes.
    let mut hidden = scene();
    hidden["tokens"] = json!([hidden["tokens"][1].clone()]);
    send(&mut dm, json!({ "t": "scene", "scene": hidden })).await;
    assert_eq!(next(&mut ray, "scene").await.unwrap()["scene"]["tokens"].as_array().unwrap().len(), 1);
    let none = |v: &Value| v["players"].as_array().unwrap().iter().all(|x| x["claim"].is_null());
    assert!(next_where(&mut ray, "players", none).await.is_some());

    // The DM leaves: players are told.
    drop(dm);
    assert_eq!(next(&mut ray, "dm").await.unwrap()["online"], json!(false));
}

#[tokio::test]
async fn pictures_are_stored_and_rooms_survive_a_restart() {
    let data = temp();
    let (addr, state) = start(&data).await;
    let code = room(&addr).await;
    let mut dm = join(&addr, &code, &format!("key={KEY}")).await;
    next(&mut dm, "welcome").await;

    // A tiny PNG as the map.
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    send(&mut dm, json!({ "t": "image", "hash": "abc123", "data": format!("data:image/png;base64,{png}") })).await;
    assert_eq!(next(&mut dm, "imageStored").await.unwrap()["hash"], json!("abc123"));
    send(&mut dm, json!({ "t": "image", "hash": "bad", "data": "data:text/html;base64,PHNjcmlwdD4=" })).await;
    assert!(next(&mut dm, "error").await.is_some(), "only pictures");
    let (status, body) = http(&addr, "GET", &format!("/api/rooms/{code}/image/abc123"), None, "").await;
    assert_eq!(status, 200);
    assert!(!body.is_empty());
    assert_eq!(http(&addr, "GET", &format!("/api/rooms/{code}/image/ffff"), None, "").await.0, 404);

    let mut s = scene();
    s["image"] = json!({ "hash": "abc123", "x": 0, "y": 0, "w": 700, "h": 490 });
    send(&mut dm, json!({ "t": "scene", "scene": s })).await;
    send(&mut dm, json!({ "t": "roll", "expr": "d20" })).await;
    next(&mut dm, "roll").await;
    state.save();

    // A new server on the same data folder has the room, its scene and its rolls.
    let (addr2, _) = start(&data).await;
    let mut ray = join(&addr2, &code, "name=Ray").await;
    let w = next(&mut ray, "welcome").await.unwrap();
    assert_eq!(w["scene"]["image"]["hash"], json!("abc123"));
    assert_eq!(w["rolls"].as_array().unwrap().len(), 1);
    assert_eq!(http(&addr2, "GET", &format!("/api/rooms/{code}/image/abc123"), None, "").await.0, 200);

    // The player page is served.
    let (status, body) = http(&addr2, "GET", &format!("/join/{code}"), None, "").await;
    assert_eq!(status, 200);
    assert!(body.contains("Join the table"));
    assert_eq!(http(&addr2, "GET", "/assets/table.js", None, "").await.0, 200);
}

#[tokio::test]
async fn players_submit_characters_the_dm_approves_or_sends_back() {
    let data = temp();
    let (addr, state) = start(&data).await;
    let code = room(&addr).await;
    let mut dm = join(&addr, &code, &format!("key={KEY}")).await;
    assert!(next(&mut dm, "welcome").await.is_some());
    send(&mut dm, json!({ "t": "rules", "rules": { "level": 1, "races": [{ "name": "Dwarf", "source": "PHB" }] } })).await;

    let pid = "AbCdEfGhIjKlMnOpQr12";
    let mut p = join(&addr, &code, &format!("name=Mira&pid={pid}")).await;
    let w = next(&mut p, "welcome").await.unwrap();
    assert_eq!(w["rules"]["races"][0]["name"], "Dwarf", "players get the rules");
    assert_eq!(w["submissions"], json!([]));

    // Without a name it's refused; with one, the DM gets it (without the player's browser id).
    send(&mut p, json!({ "t": "submit", "character": { "race": "Dwarf" } })).await;
    assert!(next(&mut p, "error").await.unwrap()["message"].as_str().unwrap().contains("name"));
    send(&mut p, json!({ "t": "submit", "character": { "name": "Thorin", "race": "Dwarf", "class": "Fighter" } })).await;
    let sub = next(&mut dm, "submission").await.unwrap()["submission"].clone();
    assert_eq!(sub["player"], "Mira");
    assert_eq!(sub["status"], "pending");
    assert!(sub.get("pid").is_none(), "player ids stay on the server");
    let sid = sub["id"].as_str().unwrap().to_string();
    let mine = next_where(&mut p, "submissions", |v| v["submissions"][0]["status"] == "pending").await.unwrap();
    assert_eq!(mine["submissions"].as_array().unwrap().len(), 1);

    // Sent back with a note; the player edits and resubmits the same one.
    send(&mut dm, json!({ "t": "review", "id": sid, "approve": false, "note": "No dwarves in the elven court" })).await;
    let back = next_where(&mut p, "submissions", |v| v["submissions"][0]["status"] == "returned").await.unwrap();
    assert_eq!(back["submissions"][0]["note"], "No dwarves in the elven court");
    send(&mut p, json!({ "t": "submit", "id": sid, "character": { "name": "Thorin", "race": "Elf", "class": "Fighter" } })).await;
    let again = next(&mut dm, "submission").await.unwrap()["submission"].clone();
    assert_eq!(again["id"], json!(sid), "a resubmission replaces the old one");

    // A stranger can't touch it.
    let mut other = join(&addr, &code, "name=Eve&pid=ZZZZZZZZZZZZZZZZZZZZ").await;
    send(&mut other, json!({ "t": "withdraw", "id": sid })).await;
    let w2 = next(&mut other, "welcome").await.unwrap();
    assert_eq!(w2["submissions"], json!([]), "others don't see it");

    // Approved: the DM made the character; it's the player's in the party.
    send(&mut dm, json!({ "t": "review", "id": sid, "approve": true, "characterId": "char-1" })).await;
    send(&mut dm, json!({ "t": "party", "party": [{ "id": "char-1", "name": "Thorin", "sheet": { "level": 1 } }, { "id": "char-2", "name": "Elara" }] })).await;
    let party = next_where(&mut p, "party", |v| v["party"].as_array().is_some_and(|a| a.len() == 2)).await.unwrap();
    assert_eq!(party["party"][0]["mine"], true);
    assert_eq!(party["party"][1]["mine"], false);
    let theirs = next_where(&mut other, "party", |v| v["party"].as_array().is_some_and(|a| a.len() == 2)).await.unwrap();
    assert_eq!(theirs["party"][0]["mine"], false);

    // It survives a restart, and the player finds their character again by their browser id.
    state.save();
    let (addr2, _) = start(&data).await;
    let mut p2 = join(&addr2, &code, &format!("name=Mira&pid={pid}")).await;
    let w3 = next(&mut p2, "welcome").await.unwrap();
    assert_eq!(w3["party"][0]["mine"], true);
    assert_eq!(w3["submissions"][0]["status"], "approved");
    assert_eq!(w3["submissions"][0]["characterId"], "char-1");
    std::fs::remove_dir_all(&data).ok();
}
