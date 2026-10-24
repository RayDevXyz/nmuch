//! Write a sample database in the old Nimbus format, for trying the import by hand:
//!
//!     cargo run -p bw-api --example nimbus_sample -- /tmp/nimbus.db

#[path = "../tests/common/nimbus_sample.rs"]
mod nimbus_sample;

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "nimbus.db".into());
    nimbus_sample::write(std::path::Path::new(&path));
    println!("wrote {path}");
}
