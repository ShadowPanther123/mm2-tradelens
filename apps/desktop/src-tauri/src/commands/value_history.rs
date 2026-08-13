use std::time::Duration;

use tauri::State;

use crate::database::models::HistoryPoint;
use crate::database::value_history;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Defensive bounds for value-history writes and reads.
const MAX_ID_LEN: usize = 64;
const MAX_SOURCE_LEN: usize = 32;
const MAX_TIMESTAMP_LEN: usize = 40;
const MAX_POINTS_PER_BATCH: usize = 20_000;
const MAX_VALUE: f64 = 1_000_000_000.0;
const MAX_HISTORY_LIMIT: i64 = 5_000;
const MAX_ALL_HISTORY_LIMIT: i64 = 100_000;

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_source(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_SOURCE_LEN
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn validate_point(p: &HistoryPoint) -> AppResult<()> {
    if !is_slug(&p.item_id) || p.item_id.len() > MAX_ID_LEN {
        return Err(AppError::Validation(format!(
            "value history point has an invalid item id \"{}\"",
            p.item_id
        )));
    }
    if !is_source(&p.source) {
        return Err(AppError::Validation(format!(
            "value history point has an invalid source \"{}\"",
            p.source
        )));
    }
    if !p.value.is_finite() || !(0.0..=MAX_VALUE).contains(&p.value) {
        return Err(AppError::Validation(format!(
            "value history point value {} is out of range",
            p.value
        )));
    }
    if p.recorded_at.trim().is_empty() || p.recorded_at.len() > MAX_TIMESTAMP_LEN {
        return Err(AppError::Validation(
            "value history point timestamp is empty or too long".into(),
        ));
    }
    if p.revision < 0 {
        return Err(AppError::Validation(
            "value history revision is negative".into(),
        ));
    }
    Ok(())
}

/// Persist a batch of value-history points captured when a snapshot revision is
/// adopted. Duplicate (item, source, revision) rows are ignored.
#[tauri::command]
pub fn record_value_history(state: State<AppState>, points: Vec<HistoryPoint>) -> AppResult<usize> {
    state.rate_limit("record_value_history", Duration::from_millis(250))?;
    if points.len() > MAX_POINTS_PER_BATCH {
        return Err(AppError::Validation(format!(
            "value history batch of {} exceeds the {MAX_POINTS_PER_BATCH} point limit",
            points.len()
        )));
    }
    for p in &points {
        validate_point(p)?;
    }
    state.with_db_mut(|conn| Ok(value_history::record(conn, &points)?))
}

/// Return the recorded value history for one item, oldest first.
#[tauri::command]
pub fn get_value_history(
    state: State<AppState>,
    item_id: String,
    limit: Option<i64>,
) -> AppResult<Vec<HistoryPoint>> {
    if !is_slug(&item_id) || item_id.len() > MAX_ID_LEN {
        return Err(AppError::Validation(format!(
            "\"{item_id}\" is not a valid item id"
        )));
    }
    let limit = limit
        .unwrap_or(MAX_HISTORY_LIMIT)
        .clamp(1, MAX_HISTORY_LIMIT);
    state.with_db(|conn| Ok(value_history::list(conn, &item_id, limit)?))
}

/// Return the recorded value history for every item at once, oldest first per
/// item. Powers the Trends view, which needs movement across many items without
/// a per-item round trip.
#[tauri::command]
pub fn get_all_value_history(
    state: State<AppState>,
    limit: Option<i64>,
) -> AppResult<Vec<HistoryPoint>> {
    let limit = limit
        .unwrap_or(MAX_ALL_HISTORY_LIMIT)
        .clamp(1, MAX_ALL_HISTORY_LIMIT);
    state.with_db(|conn| Ok(value_history::list_all(conn, limit)?))
}
