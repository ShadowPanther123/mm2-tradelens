use serde::Serialize;
use std::time::Duration;
use tauri::{LogicalSize, Manager, Size, State, WebviewWindow};

use crate::database;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Basic app metadata surfaced on the dashboard / settings page.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "MM2 TradeLens".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// Overlay dimensions for each size the UI can request.
fn size_for(size: &str) -> (f64, f64) {
    match size {
        "mini" => (380.0, 260.0),
        "expanded" => (1100.0, 760.0),
        // "trade" and anything else fall back to the default.
        _ => (820.0, 620.0),
    }
}

/// Resize the overlay window to match the size chosen in the UI.
#[tauri::command]
pub fn set_overlay_size(window: WebviewWindow, size: String) -> AppResult<()> {
    let (w, h) = size_for(&size);
    window
        .set_size(Size::Logical(LogicalSize::new(w, h)))
        .map_err(|e| AppError::Other(e.to_string()))
}

/// Toggle the always-on-top flag for the main window.
#[tauri::command]
pub fn set_always_on_top(window: WebviewWindow, enabled: bool) -> AppResult<()> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| AppError::Other(e.to_string()))
}

/// Delete every piece of local data and reset settings to defaults.
#[tauri::command]
pub fn clear_all_data(state: State<AppState>) -> AppResult<()> {
    state.rate_limit("clear_all_data", Duration::from_secs(2))?;
    state.with_db(|conn| Ok(database::clear_all(conn)?))
}

/// Rebuild the database from scratch — a safe recovery path that drops all
/// tables and re-runs migrations. Removes all local data.
#[tauri::command]
pub fn reset_database(state: State<AppState>) -> AppResult<()> {
    state.rate_limit("reset_database", Duration::from_secs(2))?;
    state.with_db_mut(|conn| Ok(database::reset(conn)?))
}

/// Show and focus the main window (used by the tray / hotkey).
#[tauri::command]
pub fn focus_window(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(|e| AppError::Other(e.to_string()))?;
        win.set_focus()
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::size_for;

    #[test]
    fn overlay_presets_have_expected_dimensions() {
        assert_eq!(size_for("mini"), (380.0, 260.0));
        assert_eq!(size_for("trade"), (820.0, 620.0));
        assert_eq!(size_for("expanded"), (1100.0, 760.0));
    }
}
