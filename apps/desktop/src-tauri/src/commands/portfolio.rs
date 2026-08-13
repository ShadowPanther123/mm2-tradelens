use tauri::State;

use crate::database::{models::PortfolioEntry, portfolio};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const MAX_ID_LEN: usize = 64;
const MAX_QUANTITY: i64 = 10_000;
const MAX_VALUE: f64 = 1e15;

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[tauri::command]
pub fn list_portfolio(state: State<AppState>) -> AppResult<Vec<PortfolioEntry>> {
    state.with_db(|conn| Ok(portfolio::list(conn)?))
}

#[tauri::command]
pub fn upsert_portfolio_entry(
    state: State<AppState>,
    item_id: String,
    quantity: i64,
    baseline_value: f64,
) -> AppResult<()> {
    if !valid_id(&item_id)
        || !(1..=MAX_QUANTITY).contains(&quantity)
        || !baseline_value.is_finite()
        || !(0.0..=MAX_VALUE).contains(&baseline_value)
    {
        return Err(AppError::Validation("invalid portfolio entry".into()));
    }
    state.with_db(|conn| Ok(portfolio::upsert(conn, &item_id, quantity, baseline_value)?))
}

#[tauri::command]
pub fn remove_portfolio_entry(state: State<AppState>, item_id: String) -> AppResult<()> {
    if !valid_id(&item_id) {
        return Err(AppError::Validation("invalid portfolio item id".into()));
    }
    state.with_db(|conn| Ok(portfolio::remove(conn, &item_id)?))
}
