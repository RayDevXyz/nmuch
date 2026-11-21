//! The hosted server over real HTTP: the owner, sessions, the protected API, tokens.

use serde_json::{json, Value};

async fn start() -> String {
    let dir = std::env::temp_dir().join(format!("bw-server-{}", std::process::id() as u128 * 1000 + rand_suffix()));
    let web = dir.join("web");
    std::fs::create_dir_all(&web).unwrap();
    std::fs::write(web.join("index.html"), "<!doctype html><title>BrainWaves</title>").unwrap();
    let app = bw_server::app(bw_server::Config { data: dir.join("data"), web, trust_proxy: false });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap() });
    format!("http://{addr}")
}
fn rand_suffix() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() % 1000
}

#[tokio::test]
async fn owner_login_api_and_tokens() {
    let base = start().await;
    let anon = reqwest::Client::new();
    let me = reqwest::Client::builder().cookie_store(true).build().unwrap();

    // The web app is served to anyone (it shows the sign-in); the API is not.
    assert_eq!(anon.get(format!("{base}/")).send().await.unwrap().status(), 200);
    assert_eq!(anon.get(format!("{base}/some/app/route")).send().await.unwrap().text().await.unwrap().contains("BrainWaves"), true);
    assert_eq!(anon.post(format!("{base}/api/listPages")).json(&json!({})).send().await.unwrap().status(), 401);
    let st: Value = anon.get(format!("{base}/api/auth/state")).send().await.unwrap().json().await.unwrap();
    assert_eq!(st["hasOwner"], false);

    // The first account is the owner; a second can't be made.
    assert_eq!(me.post(format!("{base}/api/auth/setup")).json(&json!({ "name": "Ray", "password": "short" })).send().await.unwrap().status(), 400);
    let r = me.post(format!("{base}/api/auth/setup")).json(&json!({ "name": "Ray", "password": "correct horse battery" })).send().await.unwrap();
    assert_eq!(r.status(), 200);
    let cookie = r.headers().get("set-cookie").unwrap().to_str().unwrap().to_string();
    assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Lax"), "{cookie}");
    assert_eq!(anon.post(format!("{base}/api/auth/setup")).json(&json!({ "name": "Eve", "password": "another long one" })).send().await.unwrap().status(), 400);

    // Signed in: the API works.
    let st: Value = me.get(format!("{base}/api/auth/state")).send().await.unwrap().json().await.unwrap();
    assert_eq!(st["user"], "Ray");
    let pages = me.post(format!("{base}/api/listPages")).json(&json!({})).send().await.unwrap();
    assert_eq!(pages.status(), 200);

    // A token for another app reads the API, but can't touch the account.
    let t: Value = me.post(format!("{base}/api/auth/tokens")).json(&json!({ "name": "Burrow" })).send().await.unwrap().json().await.unwrap();
    let token = t["token"].as_str().unwrap().to_string();
    let app = reqwest::Client::new();
    let r = app.post(format!("{base}/api/pagesWithTag")).bearer_auth(&token).json(&json!({ "tag": "x" })).send().await.unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(app.get(format!("{base}/api/auth/tokens")).bearer_auth(&token).send().await.unwrap().status(), 403);
    assert_eq!(app.post(format!("{base}/api/listPages")).bearer_auth("bw_wrong").json(&json!({})).send().await.unwrap().status(), 401);
    let list: Value = me.get(format!("{base}/api/auth/tokens")).send().await.unwrap().json().await.unwrap();
    assert_eq!(list[0]["name"], "Burrow");
    assert!(list[0].get("token").is_none(), "secrets are shown once");
    me.delete(format!("{base}/api/auth/tokens/{}", t["id"].as_str().unwrap())).send().await.unwrap();
    assert_eq!(app.post(format!("{base}/api/listPages")).bearer_auth(&token).json(&json!({})).send().await.unwrap().status(), 401);

    // Wrong passwords fail; signing out ends the session.
    assert_eq!(anon.post(format!("{base}/api/auth/login")).json(&json!({ "name": "Ray", "password": "nope nope nope" })).send().await.unwrap().status(), 401);
    me.post(format!("{base}/api/auth/logout")).send().await.unwrap();
    assert_eq!(me.post(format!("{base}/api/listPages")).json(&json!({})).send().await.unwrap().status(), 401);
    let r = me.post(format!("{base}/api/auth/login")).json(&json!({ "name": "ray", "password": "correct horse battery" })).send().await.unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(me.post(format!("{base}/api/listPages")).json(&json!({})).send().await.unwrap().status(), 200);
    assert_eq!(anon.get(format!("{base}/healthz")).send().await.unwrap().text().await.unwrap(), "ok");
}
