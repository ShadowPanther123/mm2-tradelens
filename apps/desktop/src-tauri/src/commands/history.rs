use tauri::State;

use crate::database::history;
use crate::database::models::{TradeRecord, TradeSlot};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Defensive bounds for persisted trade records.
const MAX_ID_LEN: usize = 64;
const MAX_MODE_LEN: usize = 32;
const MAX_DATE_LEN: usize = 40;
const MAX_SLOTS_PER_SIDE: usize = 32;
const MAX_QUANTITY: i64 = 10_000;
/// Upper bound on the recorded algorithm version. Generous, but guards against
/// obviously bogus values arriving from a tampered client.
const MAX_ALGORITHM_VERSION: i64 = 10_000;

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn validate_slot(slot: &TradeSlot) -> AppResult<()> {
    if !is_slug(&slot.item_id) || slot.item_id.len() > MAX_ID_LEN {
        return Err(AppError::Validation(format!(
            "trade slot has an invalid item id \"{}\"",
            slot.item_id
        )));
    }
    if !(1..=MAX_QUANTITY).contains(&slot.quantity) {
        return Err(AppError::Validation(format!(
            "trade slot quantity {} is out of range (1..={MAX_QUANTITY})",
            slot.quantity
        )));
    }
    Ok(())
}

fn validate_record(record: &TradeRecord) -> AppResult<()> {
    if record.id.trim().is_empty() || record.id.len() > MAX_ID_LEN {
        return Err(AppError::Validation(
            "trade record id is empty or too long".into(),
        ));
    }
    if record.date.trim().is_empty() || record.date.len() > MAX_DATE_LEN {
        return Err(AppError::Validation(
            "trade record date is empty or too long".into(),
        ));
    }
    if record.mode.trim().is_empty() || record.mode.len() > MAX_MODE_LEN {
        return Err(AppError::Validation(
            "trade record mode is empty or too long".into(),
        ));
    }
    if record.gave.is_empty() && record.received.is_empty() {
        return Err(AppError::Validation("trade record has no items".into()));
    }
    if record.gave.len() > MAX_SLOTS_PER_SIDE || record.received.len() > MAX_SLOTS_PER_SIDE {
        return Err(AppError::Validation(format!(
            "a trade side has too many items (max {MAX_SLOTS_PER_SIDE})"
        )));
    }
    if !(1..=MAX_ALGORITHM_VERSION).contains(&record.algorithm_version) {
        return Err(AppError::Validation(format!(
            "trade record algorithm version {} is out of range (1..={MAX_ALGORITHM_VERSION})",
            record.algorithm_version
        )));
    }
    if let Some(rev) = record.snapshot_revision {
        if rev < 0 {
            return Err(AppError::Validation(
                "trade record snapshot revision must not be negative".into(),
            ));
        }
    }
    for slot in record.gave.iter().chain(record.received.iter()) {
        validate_slot(slot)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_history(state: State<AppState>) -> AppResult<Vec<TradeRecord>> {
    state.with_db(|conn| Ok(history::list(conn)?))
}

#[tauri::command]
pub fn add_history_record(state: State<AppState>, record: TradeRecord) -> AppResult<()> {
    validate_record(&record)?;
    state.with_db(|conn| Ok(history::add(conn, &record)?))
}

#[tauri::command]
pub fn remove_history_record(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_db(|conn| Ok(history::remove(conn, &id)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(id: &str, qty: i64) -> TradeSlot {
        TradeSlot {
            item_id: id.into(),
            quantity: qty,
        }
    }

    fn record() -> TradeRecord {
        TradeRecord {
            id: "t1".into(),
            date: "2026-07-31T00:00:00.000Z".into(),
            gave: vec![slot("seer", 1)],
            received: vec![slot("chroma-seer", 1)],
            result_percent: 0.0,
            mode: "consensus".into(),
            algorithm_version: 1,
            snapshot_revision: None,
            calculation: None,
        }
    }

    #[test]
    fn accepts_a_valid_record() {
        assert!(validate_record(&record()).is_ok());
    }

    #[test]
    fn rejects_zero_quantity() {
        let mut r = record();
        r.gave[0].quantity = 0;
        assert!(validate_record(&r).is_err());
    }

    #[test]
    fn rejects_excessive_quantity() {
        let mut r = record();
        r.gave[0].quantity = MAX_QUANTITY + 1;
        assert!(validate_record(&r).is_err());
    }

    #[test]
    fn rejects_non_slug_item_id() {
        let mut r = record();
        r.received[0].item_id = "Seer!".into();
        assert!(validate_record(&r).is_err());
    }

    #[test]
    fn rejects_empty_record() {
        let mut r = record();
        r.gave.clear();
        r.received.clear();
        assert!(validate_record(&r).is_err());
    }

    #[test]
    fn rejects_invalid_algorithm_version() {
        let mut r = record();
        r.algorithm_version = 0;
        assert!(validate_record(&r).is_err());
    }
}
