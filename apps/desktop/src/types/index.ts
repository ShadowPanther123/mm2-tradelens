import type { Item, ValueSnapshot } from "@tradelens/item-schema";
import type { SourceMode as EngineSourceMode, TradeCalculation } from "@tradelens/trade-engine";

export type { Item, ValueSnapshot };
export type { EngineSourceMode };
export type { TradeCalculation };

/**
 * App-level value source selection. Extends the engine's calculation modes with
 * "compare-both", a display mode that shows each approved source independently.
 */
export type SourceMode = EngineSourceMode | "compare-both";
export type {
  ItemCategory,
  ItemRarity,
  SourceId,
  SourceValue,
  Stability,
} from "@tradelens/item-schema";

/** Overlay window size presets, mirrored by the Rust `set_overlay_size` command. */
export type OverlaySize = "mini" | "trade" | "expanded";

/** Persisted user settings (shape matches the Rust `Settings` model). */
export interface Settings {
  sourceMode: SourceMode;
  overlaySize: OverlaySize;
  theme: "dark" | "light";
  notificationsEnabled: boolean;
  notifyThresholdPercent: number;
  /** Alert when any item's value moves by at least this absolute amount. */
  alertAbsoluteThreshold: number;
  disagreementThresholdPercent: number;
  offlineMode: boolean;
  /**
   * Keep at most this many trade-history records (newest kept). 0 means no
   * limit. Older records beyond the limit are pruned when a trade is saved.
   */
  historyRetentionLimit: number;
}

/** A starred item plus the value captured when it was starred. */
export interface Favorite {
  itemId: string;
  baselineValue: number;
  createdAt: string;
}

/** One item + quantity on a side of a trade. */
export interface TradeSlot {
  itemId: string;
  quantity: number;
}

/** A persisted trade record. */
export interface TradeRecord {
  id: string;
  date: string;
  gave: TradeSlot[];
  received: TradeSlot[];
  resultPercent: number;
  mode: SourceMode;
  /** Version of the trade algorithm that produced this record. */
  algorithmVersion?: number;
  /** Snapshot revision whose values produced this record. */
  snapshotRevision?: number;
  /**
   * Frozen calculation detail (exact readings, resolved values, warnings and
   * verdict thresholds). Present for trades saved after this was introduced;
   * older records fall back to the summary fields above.
   */
  calculation?: TradeCalculation;
}

/** Metadata about the locally cached value snapshot. */
export interface SnapshotMeta {
  revision: number;
  generatedAt: string;
  cachedAt: string;
}

/**
 * One time-series value reading for an item from a single source, captured
 * when a snapshot revision is adopted. Drives price-history charts and alerts.
 */
export interface HistoryPoint {
  itemId: string;
  source: string;
  value: number;
  recordedAt: string;
  revision: number;
}

/** Basic app metadata from the Rust `app_info` command. */
export interface AppInfo {
  name: string;
  version: string;
}

/** Toast notification levels. */
export type ToastLevel = "info" | "success" | "warn" | "error";

export interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
}
