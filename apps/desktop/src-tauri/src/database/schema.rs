use rusqlite::{params, Connection, Transaction};

/// A single, immutable schema migration. `name` is recorded in the
/// `schema_migrations` table for auditability; `up` performs the change.
struct Migration {
    name: &'static str,
    up: fn(&Transaction) -> rusqlite::Result<()>,
}

/// Ordered list of schema migrations. The database's `PRAGMA user_version`
/// records how many have been applied; on startup any newer migrations run
/// inside their own transaction, so an interrupted upgrade never leaves the
/// database half-migrated. Add new migrations by appending to this slice —
/// never edit or reorder an existing entry.
const MIGRATIONS: &[Migration] = &[
    Migration {
        name: "001_base",
        up: m001_base,
    },
    Migration {
        name: "002_disagreement_threshold",
        up: m002_disagreement_threshold,
    },
    Migration {
        name: "003_algorithm_version",
        up: m003_algorithm_version,
    },
    Migration {
        name: "004_alert_absolute_threshold",
        up: m004_alert_absolute_threshold,
    },
    Migration {
        name: "005_history_retention_limit",
        up: m005_history_retention_limit,
    },
    Migration {
        name: "006_history_calculation",
        up: m006_history_calculation,
    },
    Migration {
        name: "007_value_history",
        up: m007_value_history,
    },
    Migration {
        name: "008_always_on_top",
        up: m008_always_on_top,
    },
];

/// Total number of migrations this build knows about — the target
/// `user_version` once all have been applied.
pub fn target_version() -> i64 {
    MIGRATIONS.len() as i64
}

/// Test-only helper: bring a connection to `up_to` applied migrations the way a
/// legacy database would look (schema applied, `user_version` set, but no
/// `schema_migrations` ledger yet).
#[cfg(test)]
pub(crate) fn migrate_to_for_test(tx: &Transaction, up_to: i64) {
    for version in 0..up_to {
        (MIGRATIONS[version as usize].up)(tx).unwrap();
    }
    tx.execute_batch(&format!("PRAGMA user_version = {up_to}"))
        .unwrap();
}

/// v1 — base schema.
fn m001_base(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS settings (
    id                        INTEGER PRIMARY KEY CHECK (id = 1),
    source_mode               TEXT    NOT NULL DEFAULT 'consensus',
    overlay_size              TEXT    NOT NULL DEFAULT 'trade',
    theme                     TEXT    NOT NULL DEFAULT 'dark',
    notifications_enabled     INTEGER NOT NULL DEFAULT 0,
    notify_threshold_percent  REAL    NOT NULL DEFAULT 5,
    offline_mode              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favorites (
    item_id        TEXT PRIMARY KEY,
    baseline_value REAL NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS trade_history (
    id             TEXT PRIMARY KEY,
    date           TEXT NOT NULL,
    gave_json      TEXT NOT NULL,
    received_json  TEXT NOT NULL,
    result_percent REAL NOT NULL,
    mode           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_date ON trade_history (date DESC);

CREATE TABLE IF NOT EXISTS snapshot_cache (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    revision     INTEGER NOT NULL,
    generated_at TEXT    NOT NULL,
    payload      TEXT    NOT NULL,
    cached_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO settings (id) VALUES (1);
"#,
    )
}

/// v2 — add the disagreement threshold setting (idempotent for databases that
/// already gained the column under the previous ad-hoc migration path).
fn m002_disagreement_threshold(tx: &Transaction) -> rusqlite::Result<()> {
    if !column_exists(tx, "settings", "disagreement_threshold_percent")? {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN disagreement_threshold_percent REAL NOT NULL DEFAULT 5",
            [],
        )?;
    }
    Ok(())
}

/// v3 — record which trade-algorithm version produced each saved trade, so a
/// historical verdict stays interpretable after the algorithm evolves.
fn m003_algorithm_version(tx: &Transaction) -> rusqlite::Result<()> {
    if !column_exists(tx, "trade_history", "algorithm_version")? {
        tx.execute(
            "ALTER TABLE trade_history ADD COLUMN algorithm_version INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }
    Ok(())
}

/// v4 — add the absolute value-change alert threshold: notify when any item
/// moves by at least this many trading units between snapshots.
fn m004_alert_absolute_threshold(tx: &Transaction) -> rusqlite::Result<()> {
    if !column_exists(tx, "settings", "alert_absolute_threshold")? {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN alert_absolute_threshold REAL NOT NULL DEFAULT 5",
            [],
        )?;
    }
    Ok(())
}

/// v5 — optional automatic trade-history retention limit (0 = unlimited).
fn m005_history_retention_limit(tx: &Transaction) -> rusqlite::Result<()> {
    if !column_exists(tx, "settings", "history_retention_limit")? {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN history_retention_limit INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

/// v6 — preserve each saved trade's full calculation: the snapshot revision it
/// used and a frozen JSON copy of the readings, resolved values, warnings and
/// verdict thresholds, so a historical verdict never changes after the fact.
fn m006_history_calculation(tx: &Transaction) -> rusqlite::Result<()> {
    if !column_exists(tx, "trade_history", "snapshot_revision")? {
        tx.execute(
            "ALTER TABLE trade_history ADD COLUMN snapshot_revision INTEGER",
            [],
        )?;
    }
    if !column_exists(tx, "trade_history", "calculation_json")? {
        tx.execute(
            "ALTER TABLE trade_history ADD COLUMN calculation_json TEXT",
            [],
        )?;
    }
    Ok(())
}

/// v7 — time-series value history: one row per (item, source, revision) so the
/// app can chart how an item's value has moved over time and drive alerts and
/// price history. Ignoring duplicates keeps re-adopting the same revision cheap.
fn m007_value_history(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS value_history (
    item_id     TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    value       REAL    NOT NULL,
    recorded_at TEXT    NOT NULL,
    revision    INTEGER NOT NULL,
    PRIMARY KEY (item_id, source, revision)
);

CREATE INDEX IF NOT EXISTS idx_value_history_item
    ON value_history (item_id, recorded_at);
"#,
    )
}

/// v8 — persist whether the overlay should remain above other windows.
fn m008_always_on_top(tx: &Transaction) -> rusqlite::Result<()> {
    if !column_exists(tx, "settings", "always_on_top")? {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN always_on_top INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }
    Ok(())
}

/// Return whether `table` has a column named `column`.
fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Apply any migrations the database has not yet seen. Safe to run on every
/// launch; each migration runs in its own transaction and advances
/// `user_version` only on success, so a failure rolls back cleanly and the
/// launch can be retried.
pub fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;

    // Independent ledger of applied migrations, kept alongside `user_version`.
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
"#,
    )?;

    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let target = target_version();

    // Backfill history for databases migrated before `schema_migrations`
    // existed, so the ledger always reflects what has actually been applied.
    for version in 0..current {
        let m = &MIGRATIONS[version as usize];
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?1, ?2)",
            params![version + 1, m.name],
        )?;
    }

    for version in current..target {
        let m = &MIGRATIONS[version as usize];
        let tx = conn.transaction()?;
        (m.up)(&tx)?;
        tx.execute(
            "INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?1, ?2)",
            params![version + 1, m.name],
        )?;
        // `version + 1` comes from our own trusted migration list (not user
        // input), and PRAGMA user_version cannot be parameterised.
        tx.execute_batch(&format!("PRAGMA user_version = {}", version + 1))?;
        tx.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_tables_and_sets_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        // Every expected table exists.
        for table in [
            "settings",
            "favorites",
            "trade_history",
            "snapshot_cache",
            "value_history",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "table {table} should exist");
        }

        // The v2 column is present.
        assert!(column_exists(&conn, "settings", "disagreement_threshold_percent").unwrap());
        // The singleton settings row was seeded.
        let settings_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(settings_rows, 1);

        // Every migration is recorded in the ledger.
        let migration_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(migration_rows, target_version());
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        // Running again must not error or duplicate the settings row.
        migrate(&mut conn).unwrap();
        let settings_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(settings_rows, 1);
    }

    #[test]
    fn migrate_upgrades_a_v1_database() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Simulate a database left at v1 (base schema, no disagreement column).
        {
            let tx = conn.transaction().unwrap();
            m001_base(&tx).unwrap();
            tx.execute_batch("PRAGMA user_version = 1").unwrap();
            tx.commit().unwrap();
        }
        assert!(!column_exists(&conn, "settings", "disagreement_threshold_percent").unwrap());

        migrate(&mut conn).unwrap();

        assert!(column_exists(&conn, "settings", "disagreement_threshold_percent").unwrap());
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        // Legacy migration 1 was backfilled and later migrations recorded.
        let names: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM schema_migrations ORDER BY version")
                .unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            rows
        };
        assert_eq!(
            names,
            vec![
                "001_base",
                "002_disagreement_threshold",
                "003_algorithm_version",
                "004_alert_absolute_threshold",
                "005_history_retention_limit",
                "006_history_calculation",
                "007_value_history",
                "008_always_on_top"
            ]
        );
    }

    #[test]
    fn migrate_preserves_existing_user_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Seed a legacy v1 database with real user rows.
        {
            let tx = conn.transaction().unwrap();
            migrate_to_for_test(&tx, 1);
            tx.execute(
                "INSERT INTO favorites (item_id, baseline_value) VALUES (?1, ?2)",
                params!["seer", 40.0],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO trade_history \
                 (id, date, gave_json, received_json, result_percent, mode) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    "trade-1",
                    "2026-07-31T00:00:00.000Z",
                    "[{\"itemId\":\"seer\",\"quantity\":1}]",
                    "[{\"itemId\":\"chroma-seer\",\"quantity\":1}]",
                    0.0,
                    "consensus"
                ],
            )
            .unwrap();
            tx.commit().unwrap();
        }

        migrate(&mut conn).unwrap();

        // User rows survive the upgrade untouched.
        let favorite: (String, f64) = conn
            .query_row("SELECT item_id, baseline_value FROM favorites", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(favorite, ("seer".to_string(), 40.0));

        let trade: (String, String, f64) = conn
            .query_row(
                "SELECT id, mode, result_percent FROM trade_history",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(trade, ("trade-1".to_string(), "consensus".to_string(), 0.0));

        // New columns added by later migrations take their defaults.
        let algorithm_version: i64 = conn
            .query_row(
                "SELECT algorithm_version FROM trade_history WHERE id = 'trade-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(algorithm_version, 1);
    }
}
