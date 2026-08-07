use rusqlite::{params, Connection};

use super::models::Favorite;

/// List favorites, newest first.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Favorite>> {
    let mut stmt = conn.prepare(
        "SELECT item_id, baseline_value, created_at
         FROM favorites ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Favorite {
            item_id: row.get(0)?,
            baseline_value: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// Add (or update the baseline of) a favorite.
pub fn add(conn: &Connection, item_id: &str, baseline_value: f64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO favorites (item_id, baseline_value)
         VALUES (?1, ?2)
         ON CONFLICT(item_id) DO UPDATE SET baseline_value = excluded.baseline_value",
        params![item_id, baseline_value],
    )?;
    Ok(())
}

/// Remove a favorite by item id.
pub fn remove(conn: &Connection, item_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM favorites WHERE item_id = ?1", params![item_id])?;
    Ok(())
}

/// True when the given item is favorited.
pub fn exists(conn: &Connection, item_id: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM favorites WHERE item_id = ?1",
        params![item_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}
