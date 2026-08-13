use tauri::State;

use crate::database::models::Settings;
use crate::database::settings;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<Settings> {
    state.with_db(|conn| Ok(settings::get(conn)?))
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: Settings) -> AppResult<()> {
    state.with_db(|conn| Ok(crate::database::settings::update(conn, &settings)?))
}
