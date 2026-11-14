//! `bw-table`: run the BrainWaves table server.
//!
//! Settings come from the environment (handy in Docker):
//! - `BW_TABLE_PORT` (default 8090)
//! - `BW_TABLE_DATA` (default `./table-data`): rooms, map pictures, rolls
//! - `BW_TABLE_DM_KEY`: the key BrainWaves uses to go live. If unset, one is generated on first
//!   start, saved in the data folder and printed.

use std::path::PathBuf;

use rand::Rng;

#[tokio::main]
async fn main() {
    let data = PathBuf::from(std::env::var("BW_TABLE_DATA").unwrap_or_else(|_| "table-data".into()));
    std::fs::create_dir_all(&data).expect("create the data folder");
    let key = match std::env::var("BW_TABLE_DM_KEY").ok().filter(|k| k.trim().len() >= 8) {
        Some(k) => k.trim().to_string(),
        None => {
            let file = data.join("dm-key.txt");
            match std::fs::read_to_string(&file).ok().map(|k| k.trim().to_string()).filter(|k| k.len() >= 8) {
                Some(k) => k,
                None => {
                    let k: String = rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric).take(24).map(char::from).collect();
                    std::fs::write(&file, &k).expect("save the DM key");
                    k
                }
            }
        }
    };
    let port: u16 = std::env::var("BW_TABLE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8090);

    let state = bw_table::AppState::load(bw_table::Config { data: data.clone(), dm_key: key.clone() }).expect("load rooms");
    bw_table::spawn_saver(state.clone());
    let app = bw_table::router(state.clone());

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    println!("BrainWaves table server on http://{addr}");
    println!("  data:   {}", data.display());
    println!("  DM key: {key}   (enter it in BrainWaves → a scene → Go live)");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    axum::serve(listener, app).with_graceful_shutdown(shutdown).await.expect("serve");
    state.save();
}
