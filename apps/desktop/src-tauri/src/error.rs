use serde::ser::SerializeStruct;
use serde::Serialize;

/// Unified error type for all commands. Serialises to a structured object
/// (`{ kind, message }`) so the frontend can branch on the error category as
/// well as show a readable message.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("serialisation error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("state is locked or poisoned")]
    Lock,

    #[error("invalid snapshot: {0}")]
    Validation(String),

    #[error("'{0}' was called too frequently; please wait a moment")]
    RateLimited(&'static str),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Stable machine-readable category for the frontend to branch on.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Database(_) => "database",
            AppError::Serde(_) => "serde",
            AppError::Io(_) => "io",
            AppError::Lock => "lock",
            AppError::Validation(_) => "validation",
            AppError::RateLimited(_) => "rate_limited",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

/// Convenience alias used throughout the command layer.
pub type AppResult<T> = Result<T, AppError>;
