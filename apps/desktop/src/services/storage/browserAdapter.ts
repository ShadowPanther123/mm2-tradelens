import type {
  AppInfo,
  Favorite,
  Settings,
  SnapshotMeta,
  TradeRecord,
  ValueSnapshot,
} from "@/types";
import type { StorageAdapter } from "./types";

/** Keys used inside the backing `Storage`. Namespaced to avoid collisions. */
const KEYS = {
  settings: "tradelens:settings",
  favorites: "tradelens:favorites",
  history: "tradelens:history",
  snapshot: "tradelens:snapshot",
  snapshotMeta: "tradelens:snapshot-meta",
} as const;

const DEFAULT_SETTINGS: Settings = {
  sourceMode: "consensus",
  overlaySize: "trade",
  theme: "dark",
  notificationsEnabled: false,
  notifyThresholdPercent: 5,
  alertAbsoluteThreshold: 5,
  disagreementThresholdPercent: 5,
  offlineMode: false,
  historyRetentionLimit: 0,
};

const APP_INFO: AppInfo = { name: "MM2 TradeLens", version: "0.1.0" };

function read<T>(store: Storage, key: string, fallback: T): T {
  const raw = store.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(store: Storage, key: string, value: unknown): void {
  store.setItem(key, JSON.stringify(value));
}

/**
 * Browser-only storage backend used when the app runs outside the Tauri shell
 * (for example `npm run dev:desktop` in a normal browser). Data is persisted in
 * the provided `Storage` — `window.localStorage` by default — so the full UI
 * can be previewed and manually tested without the native layer.
 *
 * Accepting the `Storage` explicitly keeps the adapter unit-testable without a
 * DOM.
 */
export function createBrowserStorage(store: Storage): StorageAdapter {
  return {
    kind: "browser",

    async getSettings() {
      return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(store, KEYS.settings, {}) };
    },
    async updateSettings(settings) {
      write(store, KEYS.settings, settings);
    },

    async listFavorites() {
      return read<Favorite[]>(store, KEYS.favorites, []);
    },
    async addFavorite(itemId, baselineValue) {
      const favorites = read<Favorite[]>(store, KEYS.favorites, []).filter(
        (f) => f.itemId !== itemId,
      );
      favorites.unshift({ itemId, baselineValue, createdAt: new Date().toISOString() });
      write(store, KEYS.favorites, favorites);
    },
    async removeFavorite(itemId) {
      const favorites = read<Favorite[]>(store, KEYS.favorites, []).filter(
        (f) => f.itemId !== itemId,
      );
      write(store, KEYS.favorites, favorites);
    },

    async listHistory() {
      return read<TradeRecord[]>(store, KEYS.history, []);
    },
    async addHistoryRecord(record) {
      const history = read<TradeRecord[]>(store, KEYS.history, []).filter(
        (r) => r.id !== record.id,
      );
      history.unshift(record);
      write(store, KEYS.history, history);
    },
    async removeHistoryRecord(id) {
      const history = read<TradeRecord[]>(store, KEYS.history, []).filter((r) => r.id !== id);
      write(store, KEYS.history, history);
    },

    async getCachedSnapshot() {
      return read<ValueSnapshot | null>(store, KEYS.snapshot, null);
    },
    async getSnapshotMeta() {
      return read<SnapshotMeta | null>(store, KEYS.snapshotMeta, null);
    },
    async readExternalSnapshot() {
      // The browser fallback has no local publish channel.
      return null;
    },
    async saveSnapshot(snapshot: ValueSnapshot) {
      const existing = read<SnapshotMeta | null>(store, KEYS.snapshotMeta, null);
      if (existing && snapshot.revision <= existing.revision) {
        throw new Error(
          `refusing to cache revision ${snapshot.revision} at or below current ${existing.revision}`,
        );
      }
      write(store, KEYS.snapshot, snapshot);
      write(store, KEYS.snapshotMeta, {
        revision: snapshot.revision,
        generatedAt: snapshot.generatedAt,
        cachedAt: new Date().toISOString(),
      } satisfies SnapshotMeta);
    },

    async getAppInfo() {
      return APP_INFO;
    },
    async clearAllData() {
      for (const key of Object.values(KEYS)) store.removeItem(key);
    },
  };
}
