use rusqlite::{params, Connection};

use super::models::PortfolioEntry;

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<PortfolioEntry>> {
    let mut stmt = conn.prepare(
        "SELECT item_id, quantity, baseline_value, created_at
         FROM portfolio ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PortfolioEntry {
            item_id: row.get(0)?,
            quantity: row.get(1)?,
            baseline_value: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn upsert(
    conn: &Connection,
    item_id: &str,
    quantity: i64,
    baseline_value: f64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO portfolio (item_id, quantity, baseline_value)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(item_id) DO UPDATE SET
           quantity = excluded.quantity,
           baseline_value = excluded.baseline_value",
        params![item_id, quantity, baseline_value],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, item_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM portfolio WHERE item_id = ?1", params![item_id])?;
    Ok(())
}
