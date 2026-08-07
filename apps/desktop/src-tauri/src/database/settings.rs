use rusqlite::{params, Connection};

use super::models::Settings;

/// Read the single settings row.
pub fn get(conn: &Connection) -> rusqlite::Result<Settings> {
    conn.query_row(
        "SELECT source_mode, overlay_size, theme, notifications_enabled,
                notify_threshold_percent, alert_absolute_threshold,
                disagreement_threshold_percent, offline_mode, history_retention_limit
         FROM settings WHERE id = 1",
        [],
        |row| {
            Ok(Settings {
                source_mode: row.get(0)?,
                overlay_size: row.get(1)?,
                theme: row.get(2)?,
                notifications_enabled: row.get::<_, i64>(3)? != 0,
                notify_threshold_percent: row.get(4)?,
                alert_absolute_threshold: row.get(5)?,
                disagreement_threshold_percent: row.get(6)?,
                offline_mode: row.get::<_, i64>(7)? != 0,
                history_retention_limit: row.get(8)?,
            })
        },
    )
}

/// Persist a full settings object (overwrites the single row).
pub fn update(conn: &Connection, s: &Settings) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE settings SET
            source_mode = ?1,
            overlay_size = ?2,
            theme = ?3,
            notifications_enabled = ?4,
            notify_threshold_percent = ?5,
            alert_absolute_threshold = ?6,
            disagreement_threshold_percent = ?7,
            offline_mode = ?8,
            history_retention_limit = ?9
         WHERE id = 1",
        params![
            s.source_mode,
            s.overlay_size,
            s.theme,
            s.notifications_enabled as i64,
            s.notify_threshold_percent,
            s.alert_absolute_threshold,
            s.disagreement_threshold_percent,
            s.offline_mode as i64,
            s.history_retention_limit,
        ],
    )?;
    Ok(())
}
