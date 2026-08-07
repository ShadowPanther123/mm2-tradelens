use rusqlite::{params, Connection};

use super::models::{TradeRecord, TradeSlot};

fn parse_slots(json: &str) -> rusqlite::Result<Vec<TradeSlot>> {
    serde_json::from_str(json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}

/// List saved trades, newest first.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<TradeRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, gave_json, received_json, result_percent, mode, algorithm_version,
                snapshot_revision, calculation_json
         FROM trade_history ORDER BY date DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let gave_json: String = row.get(2)?;
        let received_json: String = row.get(3)?;
        let calculation_json: Option<String> = row.get(8)?;
        let calculation = match calculation_json {
            Some(json) => serde_json::from_str(&json).ok(),
            None => None,
        };
        Ok(TradeRecord {
            id: row.get(0)?,
            date: row.get(1)?,
            gave: parse_slots(&gave_json)?,
            received: parse_slots(&received_json)?,
            result_percent: row.get(4)?,
            mode: row.get(5)?,
            algorithm_version: row.get(6)?,
            snapshot_revision: row.get(7)?,
            calculation,
        })
    })?;
    rows.collect()
}

/// Insert a trade record. Slots and the frozen calculation are stored as JSON
/// text.
pub fn add(conn: &Connection, record: &TradeRecord) -> rusqlite::Result<()> {
    let gave = serde_json::to_string(&record.gave).unwrap_or_else(|_| "[]".into());
    let received = serde_json::to_string(&record.received).unwrap_or_else(|_| "[]".into());
    let calculation = record
        .calculation
        .as_ref()
        .and_then(|c| serde_json::to_string(c).ok());
    conn.execute(
        "INSERT OR REPLACE INTO trade_history
            (id, date, gave_json, received_json, result_percent, mode, algorithm_version,
             snapshot_revision, calculation_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            record.id,
            record.date,
            gave,
            received,
            record.result_percent,
            record.mode,
            record.algorithm_version,
            record.snapshot_revision,
            calculation,
        ],
    )?;
    Ok(())
}

/// Delete a trade record by id.
pub fn remove(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM trade_history WHERE id = ?1", params![id])?;
    Ok(())
}
