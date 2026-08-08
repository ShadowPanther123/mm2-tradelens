use std::path::Path;

use rusqlite::Connection;

pub mod favorites;
pub mod history;
pub mod models;
pub mod schema;
pub mod settings;
pub mod snapshot;
pub mod value_history;

/// Open (creating if needed) the SQLite database at `path` and run migrations.
///
/// Before applying a schema upgrade to an existing database, a best-effort
/// backup copy is made so a bad migration can be recovered manually. If the
/// existing file fails its integrity check (on-disk corruption), it is moved
/// aside and a fresh database is created so the app can still start — the app
/// re-seeds its bundled snapshot and keeps working offline.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(conn) = try_open(path)? {
        return Ok(conn);
    }
    eprintln!("[db] integrity check failed; moving database aside and recreating");
    if let Err(e) = quarantine_corrupt_file(path) {
        eprintln!("[db] could not quarantine corrupt database: {e}");
    }
    match try_open(path)? {
        Some(conn) => Ok(conn),
        None => Err(rusqlite::Error::InvalidPath(path.to_path_buf())),
    }
}

/// Open and migrate. Returns `Ok(None)` when an existing file fails its quick
/// integrity check (the caller should quarantine and retry), `Ok(Some)` on
/// success, and `Err` for genuine errors.
fn try_open(path: &Path) -> rusqlite::Result<Option<Connection>> {
    let mut conn = Connection::open(path)?;
    // A quick integrity check catches on-disk corruption before we try to
    // migrate. If the check itself errors, treat the file as corrupt too.
    let status: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .unwrap_or_else(|_| "corrupt".to_string());
    if status != "ok" {
        return Ok(None);
    }
    if let Err(e) = backup_if_upgrade_pending(path, &conn) {
        eprintln!("[db] pre-migration backup skipped: {e}");
    }
    schema::migrate(&mut conn)?;
    Ok(Some(conn))
}

/// Move a corrupt database file (and its WAL/SHM sidecars) aside so a fresh one
/// can be created in its place. The quarantined copy is kept for diagnostics.
fn quarantine_corrupt_file(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let quarantined = path.with_extension(format!("corrupt-{stamp}.bak"));
        std::fs::rename(path, &quarantined)?;
    }
    // Remove WAL/SHM sidecars that could otherwise reintroduce the corruption.
    for ext in ["sqlite-wal", "sqlite-shm"] {
        let side = path.with_extension(ext);
        if side.exists() {
            let _ = std::fs::remove_file(side);
        }
    }
    Ok(())
}

/// Copy the database file aside when a real upgrade of an existing, already
/// initialised database is about to run (current version between 1 and the
/// target). Fresh databases have nothing worth backing up.
fn backup_if_upgrade_pending(path: &Path, conn: &Connection) -> std::io::Result<()> {
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    let target = schema::target_version();
    if current > 0 && current < target && path.exists() {
        let backup = path.with_extension(format!("v{current}.bak"));
        std::fs::copy(path, &backup)?;
    }
    Ok(())
}

/// Delete all user data while keeping the schema and default settings intact.
pub fn clear_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DELETE FROM favorites;
         DELETE FROM trade_history;
         DELETE FROM snapshot_cache;
         DELETE FROM value_history;
         UPDATE settings SET
            source_mode = 'consensus',
            overlay_size = 'trade',
            theme = 'dark',
            notifications_enabled = 0,
            notify_threshold_percent = 5,
            offline_mode = 0
         WHERE id = 1;",
    )?;
    Ok(())
}

/// Safe database reset: drop every table and rebuild the schema from the
/// migration list. Used as a last-resort recovery path from a corrupted or
/// incompatible database.
pub fn reset(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         DROP TABLE IF EXISTS favorites;
         DROP TABLE IF EXISTS trade_history;
         DROP TABLE IF EXISTS snapshot_cache;
         DROP TABLE IF EXISTS settings;
         DROP TABLE IF EXISTS schema_migrations;
         PRAGMA user_version = 0;",
    )?;
    schema::migrate(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reset_rebuilds_schema_and_clears_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema::migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO favorites (item_id, baseline_value) VALUES ('seer', 40)",
            [],
        )
        .unwrap();

        reset(&mut conn).unwrap();

        // Schema is back at the target version with the data gone.
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, schema::target_version());
        let favorites: i64 = conn
            .query_row("SELECT COUNT(*) FROM favorites", [], |row| row.get(0))
            .unwrap();
        assert_eq!(favorites, 0);
        // The default settings row is seeded again.
        let settings: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(settings, 1);
    }

    #[test]
    fn backup_is_created_only_for_a_pending_upgrade() {
        let dir = std::env::temp_dir().join(format!("tradelens-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tradelens.sqlite");
        let _ = std::fs::remove_file(&path);

        // Simulate an existing database left one version behind the target.
        {
            let mut conn = Connection::open(&path).unwrap();
            let tx = conn.transaction().unwrap();
            schema::migrate_to_for_test(&tx, 1);
            tx.commit().unwrap();
        }

        // Opening now should upgrade and leave a v1 backup behind.
        let _conn = open(&path).unwrap();
        let backup = path.with_extension("v1.bak");
        assert!(backup.exists(), "expected a pre-upgrade backup at {backup:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_recovers_from_a_corrupt_database_file() {
        let dir = std::env::temp_dir().join(format!("tradelens-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tradelens.sqlite");

        // Write bytes that are not a valid SQLite database.
        std::fs::write(&path, b"this is definitely not a sqlite database").unwrap();

        // Opening should quarantine the bad file and build a fresh, usable schema.
        let conn = open(&path).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, schema::target_version());
        let settings: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(settings, 1);

        // A quarantined copy of the corrupt file is kept for diagnostics.
        let quarantined: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("corrupt-")
            })
            .collect();
        assert_eq!(quarantined.len(), 1, "expected one quarantined corrupt file");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
