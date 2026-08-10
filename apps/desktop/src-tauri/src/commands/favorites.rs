use tauri::State;

use crate::database::favorites;
use crate::database::models::Favorite;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Defensive bounds for favorite records, mirroring the history/snapshot
/// validators so every command that persists client input is checked in Rust.
const MAX_ID_LEN: usize = 64;
/// Item values are large but bounded; reject absurd baselines outright.
const MAX_BASELINE_VALUE: f64 = 1e15;

/// True for a non-empty lowercase-slug identifier (`a-z`, `0-9`, `-`).
fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn validate_item_id(item_id: &str) -> AppResult<()> {
    if !is_slug(item_id) || item_id.len() > MAX_ID_LEN {
        return Err(AppError::Validation(format!(
            "favorite item id \"{item_id}\" is not a valid lowercase slug"
        )));
    }
    Ok(())
}

fn validate_baseline(baseline_value: f64) -> AppResult<()> {
    if !baseline_value.is_finite() || !(0.0..=MAX_BASELINE_VALUE).contains(&baseline_value) {
        return Err(AppError::Validation(format!(
            "favorite baseline value {baseline_value} is out of range (0..={MAX_BASELINE_VALUE})"
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn list_favorites(state: State<AppState>) -> AppResult<Vec<Favorite>> {
    state.with_db(|conn| Ok(favorites::list(conn)?))
}

#[tauri::command]
pub fn add_favorite(
    state: State<AppState>,
    item_id: String,
    baseline_value: f64,
) -> AppResult<()> {
    validate_item_id(&item_id)?;
    validate_baseline(baseline_value)?;
    state.with_db(|conn| Ok(favorites::add(conn, &item_id, baseline_value)?))
}

#[tauri::command]
pub fn remove_favorite(state: State<AppState>, item_id: String) -> AppResult<()> {
    validate_item_id(&item_id)?;
    state.with_db(|conn| Ok(favorites::remove(conn, &item_id)?))
}

#[tauri::command]
pub fn is_favorite(state: State<AppState>, item_id: String) -> AppResult<bool> {
    validate_item_id(&item_id)?;
    state.with_db(|conn| Ok(favorites::exists(conn, &item_id)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_valid_item_id() {
        assert!(validate_item_id("chroma-seer").is_ok());
    }

    #[test]
    fn rejects_non_slug_item_id() {
        assert!(validate_item_id("Seer!").is_err());
        assert!(validate_item_id("").is_err());
        assert!(validate_item_id(&"a".repeat(MAX_ID_LEN + 1)).is_err());
    }

    #[test]
    fn accepts_a_reasonable_baseline() {
        assert!(validate_baseline(0.0).is_ok());
        assert!(validate_baseline(125_000.0).is_ok());
    }

    #[test]
    fn rejects_non_finite_or_negative_baseline() {
        assert!(validate_baseline(f64::NAN).is_err());
        assert!(validate_baseline(f64::INFINITY).is_err());
        assert!(validate_baseline(-1.0).is_err());
        assert!(validate_baseline(MAX_BASELINE_VALUE * 10.0).is_err());
    }
}
