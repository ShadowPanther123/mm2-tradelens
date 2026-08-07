use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Application state managed by Tauri. Wraps the single SQLite connection in a
/// mutex so it can be shared safely across command invocations.
pub struct AppState {
    db: Mutex<Connection>,
    /// Last-invocation timestamps for rate-limited commands, keyed by name.
    rate_limits: Mutex<HashMap<&'static str, Instant>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self {
            db: Mutex::new(conn),
            rate_limits: Mutex::new(HashMap::new()),
        }
    }

    /// Run a closure with locked access to the database connection.
    pub fn with_db<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let guard = self.db.lock().map_err(|_| AppError::Lock)?;
        f(&guard)
    }

    /// Run a closure with mutable locked access — required for operations such
    /// as migrations and resets that need `&mut Connection`.
    pub fn with_db_mut<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.db.lock().map_err(|_| AppError::Lock)?;
        f(&mut guard)
    }

    /// Throttle an expensive command: returns an error if `key` was invoked
    /// within `min_interval`. Prevents a compromised/buggy frontend from
    /// hammering costly native operations (snapshot writes, database resets).
    pub fn rate_limit(&self, key: &'static str, min_interval: Duration) -> AppResult<()> {
        let now = Instant::now();
        let mut guard = self.rate_limits.lock().map_err(|_| AppError::Lock)?;
        if let Some(last) = guard.get(key) {
            if now.duration_since(*last) < min_interval {
                return Err(AppError::RateLimited(key));
            }
        }
        guard.insert(key, now);
        Ok(())
    }
}

