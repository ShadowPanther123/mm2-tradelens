use rusqlite::{params, Connection};

use super::models::HistoryPoint;

/// Defensive cap on how many points a single-item read returns.
const MAX_LIMIT: i64 = 5_000;

/// Defensive cap on how many points a whole-database read returns.
const MAX_ALL_LIMIT: i64 = 100_000;

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

/// Return the recorded value history for every item, oldest first, capped at
/// `limit` rows overall (the most recent rows are kept). Powers the Trends view,
/// which needs movement across many items without a per-item round trip.
pub fn list_all(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<HistoryPoint>> {
    let capped = limit.clamp(1, MAX_ALL_LIMIT);
    let mut stmt = conn.prepare(
        "SELECT item_id, source, value, recorded_at, revision
         FROM (
            SELECT item_id, source, value, recorded_at, revision
            FROM value_history
            ORDER BY revision DESC, recorded_at DESC, item_id ASC, source ASC
            LIMIT ?1
         )
         ORDER BY item_id ASC, revision ASC, recorded_at ASC, source ASC",
    )?;
    let rows = stmt.query_map(params![capped], |row| {
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
#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema;

    fn point(item: &str, revision: i64, value: f64) -> HistoryPoint {
        HistoryPoint {
            item_id: item.into(),
            source: "mm2values".into(),
            value,
            recorded_at: format!("2026-01-{:02}T00:00:00Z", revision.max(1)),
            revision,
        }
    }

    #[test]
    fn list_all_returns_every_item_oldest_first_per_item() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema::migrate(&mut conn).unwrap();
        record(
            &mut conn,
            &[
                point("seer", 2, 45.0),
                point("seer", 1, 40.0),
                point("chroma-seer", 1, 100.0),
                point("chroma-seer", 3, 130.0),
            ],
        )
        .unwrap();

        let all = list_all(&conn, 100).unwrap();
        assert_eq!(all.len(), 4);
        // Grouped by item id, each item's points ascend by revision.
        let seer: Vec<_> = all.iter().filter(|p| p.item_id == "seer").collect();
        assert_eq!(
            seer.iter().map(|p| p.revision).collect::<Vec<_>>(),
            vec![1, 2]
        );
        let chroma: Vec<_> = all.iter().filter(|p| p.item_id == "chroma-seer").collect();
        assert_eq!(
            chroma.iter().map(|p| p.revision).collect::<Vec<_>>(),
            vec![1, 3]
        );
    }

    #[test]
    fn list_all_keeps_the_most_recent_rows_under_the_cap() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema::migrate(&mut conn).unwrap();
        record(
            &mut conn,
            &[
                point("seer", 1, 10.0),
                point("seer", 2, 20.0),
                point("seer", 3, 30.0),
            ],
        )
        .unwrap();

        let capped = list_all(&conn, 2).unwrap();
        assert_eq!(capped.len(), 2);
        // The two newest revisions are kept, presented oldest-first.
        assert_eq!(
            capped.iter().map(|p| p.revision).collect::<Vec<_>>(),
            vec![2, 3]
        );
    }
}
