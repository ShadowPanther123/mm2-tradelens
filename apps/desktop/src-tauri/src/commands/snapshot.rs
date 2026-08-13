use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;
use tauri::{Manager, State};

use crate::database::models::SnapshotMeta;
use crate::database::snapshot;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Snapshot schema version this build understands. Must match the TypeScript
/// `CURRENT_SCHEMA_VERSION`.
const SUPPORTED_SCHEMA_VERSION: u64 = 1;

/// File name of the optional externally-published snapshot dropped into the
/// app data directory by the local publish step (`scripts/publish-local`).
/// Reading it lets a fresh values sync reach an already-installed app without
/// rebuilding the installer or running a network service.
const EXTERNAL_SNAPSHOT_FILE: &str = "values-snapshot.json";

/// Defensive bounds applied to snapshot payloads before they are cached.
const MAX_PAYLOAD_BYTES: usize = 8 * 1024 * 1024; // 8 MiB
const MAX_ID_LEN: usize = 64;
const MAX_NAME_LEN: usize = 120;
const MAX_SOURCE_LEN: usize = 32;
const MIN_YEAR: i64 = 2020;
const MAX_YEAR: i64 = 2100;

/// Typed view of the snapshot header, so the fields the app relies on are
/// validated by the deserializer instead of by hand-rolled `Value` probing.
#[derive(Debug, Deserialize)]
struct SnapshotHeader {
    #[serde(rename = "schemaVersion")]
    schema_version: u64,
    revision: i64,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    sources: Vec<String>,
}

/// Return the cached value snapshot, or `null` when nothing is cached yet.
#[tauri::command]
pub fn get_snapshot(state: State<AppState>) -> AppResult<Option<Value>> {
    state.with_db(|conn| Ok(snapshot::get(conn)?))
}

/// Return metadata (revision / timestamps) about the cached snapshot.
#[tauri::command]
pub fn get_snapshot_meta(state: State<AppState>) -> AppResult<Option<SnapshotMeta>> {
    state.with_db(|conn| Ok(snapshot::meta(conn)?))
}

/// Read an externally-published snapshot from `values-snapshot.json` in the app
/// data directory, if present. This is the offline update channel: a values
/// sync writes the fresh snapshot there (see `scripts/publish-local`) and the
/// frontend's "Check for updates" adopts it — no rebuild or network service
/// required. Returns `null` when no file is present; the payload is only parsed
/// as JSON here and re-validated by `save_snapshot` before it is ever cached.
#[tauri::command]
pub fn read_external_snapshot(app: tauri::AppHandle) -> AppResult<Option<Value>> {
    let dir = crate::smoke_app_data_dir().map_or_else(
        || app.path().app_data_dir().map_err(|e| AppError::Other(e.to_string())),
        Ok,
    )?;
    let path = dir.join(EXTERNAL_SNAPSHOT_FILE);

    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(AppError::Other(err.to_string())),
    };
    if bytes.len() > MAX_PAYLOAD_BYTES {
        return Err(AppError::Validation(format!(
            "external snapshot is too large: {} bytes (max {MAX_PAYLOAD_BYTES})",
            bytes.len()
        )));
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Validation(format!("external snapshot is not valid JSON: {e}")))?;
    Ok(Some(value))
}

/// Cache a snapshot supplied by the frontend (seed data or a downloaded feed).
///
/// The payload is validated structurally before it is stored, and downgrades
/// (a revision at or below the one already cached) are rejected — defence in
/// depth behind the frontend's own signature and freshness checks.
#[tauri::command]
pub fn save_snapshot(
    state: State<AppState>,
    revision: i64,
    generated_at: String,
    payload: Value,
) -> AppResult<()> {
    state.rate_limit("save_snapshot", Duration::from_millis(500))?;
    validate_snapshot(&payload, revision, &generated_at)?;
    state.with_db(|conn| {
        if let Some(existing) = snapshot::meta(conn)? {
            if revision <= existing.revision {
                return Err(AppError::Validation(format!(
                    "refusing to cache revision {revision} at or below the current {}",
                    existing.revision
                )));
            }
        }
        snapshot::save(conn, revision, &generated_at, &payload)?;
        Ok(())
    })
}

/// True for a non-empty lowercase-slug identifier (`a-z`, `0-9`, `-`).
fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Loose sanity check that a timestamp is an ISO-8601 value within a plausible
/// range, rejecting empty strings and obviously wrong dates without pulling in
/// a date-parsing dependency.
fn is_reasonable_timestamp(ts: &str) -> bool {
    if ts.len() < 20 || ts.len() > 30 {
        return false;
    }
    let bytes = ts.as_bytes();
    let year: i64 = match ts.get(0..4).and_then(|y| y.parse().ok()) {
        Some(y) => y,
        None => return false,
    };
    if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
        return false;
    }
    bytes[4] == b'-' && bytes[7] == b'-' && (bytes[10] == b'T' || bytes[10] == b' ')
}

/// Structural validation of a snapshot payload. Rejects anything that does not
/// match the shape the app relies on, with a specific reason for diagnostics.
fn validate_snapshot(payload: &Value, revision: i64, generated_at: &str) -> AppResult<()> {
    if revision < 0 {
        return Err(AppError::Validation("revision must be non-negative".into()));
    }
    if !is_reasonable_timestamp(generated_at) {
        return Err(AppError::Validation(format!(
            "generatedAt \"{generated_at}\" is not a reasonable timestamp"
        )));
    }

    // Payload size guard (defence in depth behind the frontend download cap).
    let serialized_len = serde_json::to_string(payload)?.len();
    if serialized_len > MAX_PAYLOAD_BYTES {
        return Err(AppError::Validation(format!(
            "payload is too large: {serialized_len} bytes (max {MAX_PAYLOAD_BYTES})"
        )));
    }

    // Validate the header via a typed struct.
    let header = SnapshotHeader::deserialize(payload)
        .map_err(|e| AppError::Validation(format!("invalid snapshot header: {e}")))?;

    if header.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(AppError::Validation(format!(
            "unsupported schemaVersion {} (expected {SUPPORTED_SCHEMA_VERSION})",
            header.schema_version
        )));
    }
    if header.revision != revision {
        return Err(AppError::Validation(format!(
            "revision mismatch: header {revision} vs payload {}",
            header.revision
        )));
    }
    if header.generated_at != generated_at {
        return Err(AppError::Validation(
            "generatedAt mismatch between argument and payload".into(),
        ));
    }
    if header.sources.is_empty() {
        return Err(AppError::Validation("sources must not be empty".into()));
    }
    for source in &header.sources {
        if !is_slug(source) || source.len() > MAX_SOURCE_LEN {
            return Err(AppError::Validation(format!(
                "source \"{source}\" is not a valid identifier"
            )));
        }
    }

    let obj = payload
        .as_object()
        .ok_or_else(|| AppError::Validation("payload must be an object".into()))?;

    let items = obj
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Validation("items must be an array".into()))?;

    for (i, item) in items.iter().enumerate() {
        let item = item
            .as_object()
            .ok_or_else(|| AppError::Validation(format!("item {i} must be an object")))?;
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Validation(format!("item {i} missing id")))?;
        if !is_slug(id) {
            return Err(AppError::Validation(format!(
                "item {i} id \"{id}\" is not a lowercase slug"
            )));
        }
        if id.len() > MAX_ID_LEN {
            return Err(AppError::Validation(format!(
                "item {id} id is too long (max {MAX_ID_LEN})"
            )));
        }
        match item.get("displayName").and_then(Value::as_str) {
            Some(name) if !name.is_empty() && name.len() <= MAX_NAME_LEN => {}
            Some(_) => {
                return Err(AppError::Validation(format!(
                    "item {id} displayName is empty or longer than {MAX_NAME_LEN}"
                )))
            }
            None => {
                return Err(AppError::Validation(format!(
                    "item {id} missing displayName"
                )))
            }
        }
        match item.get("values").and_then(Value::as_object) {
            Some(values) if !values.is_empty() => {
                for source in values.keys() {
                    if !is_slug(source) || source.len() > MAX_SOURCE_LEN {
                        return Err(AppError::Validation(format!(
                            "item {id} has an invalid source identifier \"{source}\""
                        )));
                    }
                }
            }
            _ => {
                return Err(AppError::Validation(format!(
                    "item {id} must have at least one source value"
                )))
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_payload(revision: i64) -> Value {
        json!({
            "schemaVersion": 1,
            "revision": revision,
            "generatedAt": "2026-07-31T00:00:00.000Z",
            "sources": ["supreme", "mm2values"],
            "items": [{
                "id": "seer",
                "displayName": "Seer",
                "aliases": [],
                "category": "gun",
                "rarity": "godly",
                "chroma": false,
                "verified": true,
                "values": { "supreme": { "value": 40, "updatedAt": "2026-07-31T00:00:00.000Z" } }
            }]
        })
    }

    #[test]
    fn accepts_a_well_formed_snapshot() {
        assert!(validate_snapshot(&valid_payload(3), 3, "2026-07-31T00:00:00.000Z").is_ok());
    }

    #[test]
    fn rejects_negative_revision() {
        assert!(validate_snapshot(&valid_payload(0), -1, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_empty_generated_at() {
        assert!(validate_snapshot(&valid_payload(3), 3, "  ").is_err());
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let mut payload = valid_payload(3);
        payload["schemaVersion"] = json!(999);
        assert!(validate_snapshot(&payload, 3, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_revision_mismatch_between_header_and_body() {
        assert!(validate_snapshot(&valid_payload(3), 4, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_non_slug_item_id() {
        let mut payload = valid_payload(3);
        payload["items"][0]["id"] = json!("Seer!");
        assert!(validate_snapshot(&payload, 3, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_item_without_values() {
        let mut payload = valid_payload(3);
        payload["items"][0]["values"] = json!({});
        assert!(validate_snapshot(&payload, 3, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_missing_items_array() {
        let mut payload = valid_payload(3);
        payload["items"] = json!("nope");
        assert!(validate_snapshot(&payload, 3, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_unreasonable_timestamp() {
        assert!(validate_snapshot(&valid_payload(3), 3, "1999-01-01T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_invalid_source_identifier() {
        let mut payload = valid_payload(3);
        payload["sources"] = json!(["Supreme Values"]);
        assert!(validate_snapshot(&payload, 3, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_overlong_display_name() {
        let mut payload = valid_payload(3);
        payload["items"][0]["displayName"] = json!("x".repeat(MAX_NAME_LEN + 1));
        assert!(validate_snapshot(&payload, 3, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_non_slug_value_source_key() {
        let mut payload = valid_payload(3);
        payload["items"][0]["values"] = json!({
            "Not A Slug": { "value": 40, "updatedAt": "2026-07-31T00:00:00.000Z" }
        });
        assert!(validate_snapshot(&payload, 3, "2026-07-31T00:00:00.000Z").is_err());
    }

    #[test]
    fn rejects_generated_at_mismatch() {
        // Header timestamp differs from the argument.
        assert!(validate_snapshot(&valid_payload(3), 3, "2026-08-01T00:00:00.000Z").is_err());
    }
}
