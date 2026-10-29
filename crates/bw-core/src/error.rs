use thiserror::Error;

/// Every fallible operation in the core returns this error type.
#[derive(Debug, Error)]
pub enum Error {
    #[error("sqlite error: {0}")]
    Sql(#[from] rusqlite::Error),

    #[error("page not found: {0}")]
    PageNotFound(String),

    #[error("block not found: {0}")]
    BlockNotFound(String),

    #[error("invalid operation: {0}")]
    Invalid(String),

    #[error("could not decode yrs update: {0}")]
    Decode(String),

    #[error("could not apply yrs update: {0}")]
    Apply(String),

    #[error("malformed block data: {0}")]
    Malformed(String),

    /// A widget tried to do something its manifest and bindings don't allow.
    #[error("not allowed: {0}")]
    Forbidden(String),
}

pub type Result<T> = std::result::Result<T, Error>;
