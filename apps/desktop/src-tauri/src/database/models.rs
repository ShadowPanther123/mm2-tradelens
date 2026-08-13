use serde::{Deserialize, Serialize};

/// User settings (single-row table). Field names are camelCased for the
/// frontend via serde rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub source_mode: String,
    pub overlay_size: String,
    pub always_on_top: bool,
    pub theme: String,
    pub notifications_enabled: bool,
    pub notify_threshold_percent: f64,
    /// Alert when any item's value moves by at least this absolute amount.
    pub alert_absolute_threshold: f64,
    pub disagreement_threshold_percent: f64,
    pub offline_mode: bool,
    /// Keep at most this many trade-history records (0 = unlimited).
    pub history_retention_limit: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            source_mode: "consensus".into(),
            overlay_size: "trade".into(),
            always_on_top: true,
            theme: "dark".into(),
            notifications_enabled: false,
            notify_threshold_percent: 5.0,
            alert_absolute_threshold: 5.0,
            disagreement_threshold_percent: 5.0,
            offline_mode: false,
            history_retention_limit: 0,
        }
    }
}

/// A starred item plus the value captured when it was starred.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub item_id: String,
    pub baseline_value: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioEntry {
    pub item_id: String,
    pub quantity: i64,
    pub baseline_value: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStat {
    pub item_id: String,
    pub count: i64,
    pub last_searched_at: String,
}

/// One item + quantity on a side of a saved trade.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeSlot {
    pub item_id: String,
    pub quantity: i64,
}

/// A saved trade record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeRecord {
    pub id: String,
    pub date: String,
    pub gave: Vec<TradeSlot>,
    pub received: Vec<TradeSlot>,
    pub result_percent: f64,
    pub mode: String,
    /// Version of the trade algorithm that produced this record. Older records
    /// (and clients that omit it) default to version 1.
    #[serde(default = "default_algorithm_version")]
    pub algorithm_version: i64,
    /// Snapshot revision whose values produced this record, if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_revision: Option<i64>,
    /// Frozen calculation detail as opaque JSON (exact readings, resolved
    /// values, warnings and verdict thresholds). Preserved verbatim so a saved
    /// trade stays interpretable after values or the algorithm change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculation: Option<serde_json::Value>,
}

fn default_algorithm_version() -> i64 {
    1
}

/// Metadata about the cached value snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub revision: i64,
    pub generated_at: String,
    pub cached_at: String,
}

/// One time-series value reading for an item from a single source, captured
/// when a snapshot revision is adopted. Drives price-history charts and alerts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub item_id: String,
    pub source: String,
    pub value: f64,
    pub recorded_at: String,
    pub revision: i64,
}
