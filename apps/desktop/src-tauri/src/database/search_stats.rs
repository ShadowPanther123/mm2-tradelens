use rusqlite::{params, Connection};

use super::models::SearchStat;

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<SearchStat>> {
    let mut stmt = conn.prepare(
        "SELECT item_id, count, last_searched_at
         FROM search_stats ORDER BY count DESC, last_searched_at DESC LIMIT 100",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SearchStat {
            item_id: row.get(0)?,
            count: row.get(1)?,
            last_searched_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn record(conn: &Connection, item_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO search_stats (item_id, count) VALUES (?1, 1)
         ON CONFLICT(item_id) DO UPDATE SET
           count = count + 1,
           last_searched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![item_id],
    )?;
    Ok(())
}
