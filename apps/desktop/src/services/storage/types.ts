import type {
  AppInfo,
  Favorite,
  Settings,
  SnapshotMeta,
  TradeRecord,
  ValueSnapshot,
} from "@/types";

/**
 * Shared persistence contract implemented by every runtime backend. The rest
 * of the app talks to storage through this interface only, so the same UI runs
 * against the native Tauri SQLite backend or a browser-only fallback without
 * knowing which is active.
 */
export interface StorageAdapter {
  /** Human-readable backend name, used in diagnostics. */
  readonly kind: "tauri" | "browser";

  getSettings(): Promise<Settings>;
  updateSettings(settings: Settings): Promise<void>;

  listFavorites(): Promise<Favorite[]>;
  addFavorite(itemId: string, baselineValue: number): Promise<void>;
  removeFavorite(itemId: string): Promise<void>;

  listHistory(): Promise<TradeRecord[]>;
  addHistoryRecord(record: TradeRecord): Promise<void>;
  removeHistoryRecord(id: string): Promise<void>;

  getCachedSnapshot(): Promise<ValueSnapshot | null>;
  getSnapshotMeta(): Promise<SnapshotMeta | null>;
  saveSnapshot(snapshot: ValueSnapshot): Promise<void>;

  /**
   * Read an externally-published snapshot dropped into the app data directory
   * by the local publish step, or null when none is present or the runtime has
   * no such channel (browser fallback).
   */
  readExternalSnapshot(): Promise<ValueSnapshot | null>;

  getAppInfo(): Promise<AppInfo>;
  clearAllData(): Promise<void>;
}
