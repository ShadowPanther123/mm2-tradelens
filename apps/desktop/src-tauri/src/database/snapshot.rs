use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::models::SnapshotMeta;

/// Read the cached snapshot payload as JSON, if present.
pub fn get(conn: &Connection) -> rusqlite::Result<Option<Value>> {
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload FROM snapshot_cache WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;

    match payload {
        Some(text) => {
            let value: Value = serde_json::from_str(&text).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            Ok(Some(value))
        }
        None => Ok(None),
    }
}

/// Read only the metadata about the cached snapshot.
pub fn meta(conn: &Connection) -> rusqlite::Result<Option<SnapshotMeta>> {
    conn.query_row(
        "SELECT revision, generated_at, cached_at FROM snapshot_cache WHERE id = 1",
        [],
        |row| {
            Ok(SnapshotMeta {
                revision: row.get(0)?,
                generated_at: row.get(1)?,
                cached_at: row.get(2)?,
            })
        },
    )
    .optional()
}

/// Store (replace) the cached snapshot.
pub fn save(
    conn: &Connection,
    revision: i64,
    generated_at: &str,
    payload: &Value,
) -> rusqlite::Result<()> {
    let text = serde_json::to_string(payload).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(e))
    })?;
    conn.execute(
        "INSERT INTO snapshot_cache (id, revision, generated_at, payload, cached_at)
         VALUES (1, ?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(id) DO UPDATE SET
            revision = excluded.revision,
            generated_at = excluded.generated_at,
            payload = excluded.payload,
            cached_at = excluded.cached_at",
        params![revision, generated_at, text],
    )?;
    Ok(())
}
