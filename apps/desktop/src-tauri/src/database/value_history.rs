use rusqlite::{params, Connection};

use super::models::HistoryPoint;

/// Defensive cap on how many points a single read returns.
const MAX_LIMIT: i64 = 5_000;

/// Record a batch of value-history points. Duplicate (item, source, revision)
/// rows are ignored, so re-adopting the same snapshot revision is a no-op and
/// the whole batch is written in one transaction for speed.
pub fn record(conn: &mut Connection, points: &[HistoryPoint]) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut written = 0usize;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO value_history
                (item_id, source, value, recorded_at, revision)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for p in points {
            written += stmt.execute(params![
                p.item_id,
                p.source,
                p.value,
                p.recorded_at,
                p.revision,
            ])?;
        }
    }
    tx.commit()?;
    Ok(written)
}

/// Return the value history for one item, oldest first, capped at `limit`
/// (most recent points are kept when the history is longer than the cap).
pub fn list(conn: &Connection, item_id: &str, limit: i64) -> rusqlite::Result<Vec<HistoryPoint>> {
    let capped = limit.clamp(1, MAX_LIMIT);
    // Take the most recent `capped` rows, then present them oldest-first.
    let mut stmt = conn.prepare(
        "SELECT item_id, source, value, recorded_at, revision
         FROM (
            SELECT item_id, source, value, recorded_at, revision
            FROM value_history
            WHERE item_id = ?1
            ORDER BY revision DESC, recorded_at DESC
            LIMIT ?2
         )
         ORDER BY revision ASC, recorded_at ASC",
    )?;
    let rows = stmt.query_map(params![item_id, capped], |row| {
        Ok(HistoryPoint {
            item_id: row.get(0)?,
            source: row.get(1)?,
            value: row.get(2)?,
            recorded_at: row.get(3)?,
            revision: row.get(4)?,
        })
    })?;
    rows.collect()
}
