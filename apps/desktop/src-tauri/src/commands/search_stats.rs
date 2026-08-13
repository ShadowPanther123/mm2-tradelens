use tauri::State;

use crate::database::{models::SearchStat, search_stats};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[tauri::command]
pub fn list_search_stats(state: State<AppState>) -> AppResult<Vec<SearchStat>> {
    state.with_db(|conn| Ok(search_stats::list(conn)?))
}

#[tauri::command]
pub fn record_search(state: State<AppState>, item_id: String) -> AppResult<()> {
    if !valid_id(&item_id) {
        return Err(AppError::Validation("invalid searched item id".into()));
    }
    state.with_db(|conn| Ok(search_stats::record(conn, &item_id)?))
}
