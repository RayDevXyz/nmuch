//! The `bw-server` binary: see the `bw_server` crate docs.

#[tokio::main]
async fn main() {
    bw_server::run().await
}
