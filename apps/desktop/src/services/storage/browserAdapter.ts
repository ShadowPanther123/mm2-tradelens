import type {
  AppInfo,
  Favorite,
  HistoryPoint,
  PortfolioEntry,
  SearchStat,
  Settings,
  SnapshotMeta,
  TradeRecord,
  ValueSnapshot,
} from "@/types";
import { safeParseSnapshot } from "@tradelens/item-schema";
import type { StorageAdapter } from "./types";

/** Keys used inside the backing `Storage`. Namespaced to avoid collisions. */
const KEYS = {
  settings: "tradelens:settings",
  favorites: "tradelens:favorites",
  history: "tradelens:history",
  snapshot: "tradelens:snapshot",
  snapshotMeta: "tradelens:snapshot-meta",
  valueHistory: "tradelens:value-history",
  portfolio: "tradelens:portfolio",
  searchStats: "tradelens:search-stats",
} as const;

const DEFAULT_SETTINGS: Settings = {
  sourceMode: "consensus",
  overlaySize: "trade",
  alwaysOnTop: true,
  theme: "dark",
  notificationsEnabled: false,
  notifyThresholdPercent: 5,
  alertAbsoluteThreshold: 5,
  disagreementThresholdPercent: 5,
  offlineMode: false,
  historyRetentionLimit: 0,
};

const APP_INFO: AppInfo = { name: "MM2 TradeLens", version: "0.1.0" };
const MAX_HISTORY_LIMIT = 5_000;
const MAX_ALL_HISTORY_LIMIT = 100_000;

function boundedLimit(limit: number | undefined, maximum: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return maximum;
  return Math.min(maximum, Math.max(1, Math.trunc(limit)));
}

type Validator<T> = (value: unknown) => value is T;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isSettings = (value: unknown): value is Partial<Settings> => isObject(value);
const isFavorite = (value: unknown): value is Favorite =>
  isObject(value) &&
  typeof value.itemId === "string" &&
  isFiniteNumber(value.baselineValue) &&
  typeof value.createdAt === "string";
const isPortfolioEntry = (value: unknown): value is PortfolioEntry =>
  isObject(value) &&
  typeof value.itemId === "string" &&
  isFiniteNumber(value.quantity) &&
  isFiniteNumber(value.baselineValue) &&
  typeof value.createdAt === "string";
const isSearchStat = (value: unknown): value is SearchStat =>
  isObject(value) &&
  typeof value.itemId === "string" &&
  isFiniteNumber(value.count) &&
  typeof value.lastSearchedAt === "string";
const isTradeSlot = (value: unknown): boolean =>
  isObject(value) && typeof value.itemId === "string" && isFiniteNumber(value.quantity);
const isTradeRecord = (value: unknown): value is TradeRecord =>
  isObject(value) &&
  typeof value.id === "string" &&
  typeof value.date === "string" &&
  typeof value.mode === "string" &&
  isFiniteNumber(value.resultPercent) &&
  Array.isArray(value.gave) &&
  value.gave.every(isTradeSlot) &&
  Array.isArray(value.received) &&
  value.received.every(isTradeSlot);
const isSnapshot = (value: unknown): value is ValueSnapshot =>
  safeParseSnapshot(value).success;
const isSnapshotMeta = (value: unknown): value is SnapshotMeta =>
  isObject(value) &&
  isFiniteNumber(value.revision) &&
  typeof value.generatedAt === "string" &&
  typeof value.cachedAt === "string";
const isHistoryPoint = (value: unknown): value is HistoryPoint =>
  isObject(value) &&
  typeof value.itemId === "string" &&
  typeof value.source === "string" &&
  isFiniteNumber(value.value) &&
  typeof value.recordedAt === "string" &&
  isFiniteNumber(value.revision);
const arrayOf =
  <T>(validator: Validator<T>): Validator<T[]> =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(validator);

function read<T>(store: Storage, key: string, fallback: T, validate: Validator<T>): T {
  const raw = store.getItem(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed) ? parsed : fallback;
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
      return { ...DEFAULT_SETTINGS, ...read(store, KEYS.settings, {}, isSettings) };
    },
    async updateSettings(settings) {
      write(store, KEYS.settings, settings);
    },

    async listFavorites() {
      return read(store, KEYS.favorites, [], arrayOf(isFavorite));
    },
    async addFavorite(itemId, baselineValue) {
      const favorites = read(store, KEYS.favorites, [], arrayOf(isFavorite)).filter(
        (f) => f.itemId !== itemId,
      );
      favorites.unshift({ itemId, baselineValue, createdAt: new Date().toISOString() });
      write(store, KEYS.favorites, favorites);
    },
    async removeFavorite(itemId) {
      const favorites = read(store, KEYS.favorites, [], arrayOf(isFavorite)).filter(
        (f) => f.itemId !== itemId,
      );
      write(store, KEYS.favorites, favorites);
    },

    async listPortfolio() {
      return read(store, KEYS.portfolio, [], arrayOf(isPortfolioEntry));
    },
    async upsertPortfolioEntry(itemId, quantity, baselineValue) {
      const entries = read(store, KEYS.portfolio, [], arrayOf(isPortfolioEntry));
      const existing = entries.find((entry) => entry.itemId === itemId);
      const next = entries.filter((entry) => entry.itemId !== itemId);
      next.unshift({
        itemId,
        quantity,
        baselineValue,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      write(store, KEYS.portfolio, next);
    },
    async removePortfolioEntry(itemId) {
      const entries = read(store, KEYS.portfolio, [], arrayOf(isPortfolioEntry)).filter(
        (entry) => entry.itemId !== itemId,
      );
      write(store, KEYS.portfolio, entries);
    },

    async listSearchStats() {
      return read(store, KEYS.searchStats, [], arrayOf(isSearchStat)).sort(
        (a, b) => b.count - a.count || b.lastSearchedAt.localeCompare(a.lastSearchedAt),
      );
    },
    async recordSearch(itemId) {
      const stats = read(store, KEYS.searchStats, [], arrayOf(isSearchStat));
      const existing = stats.find((entry) => entry.itemId === itemId);
      const next = stats.filter((entry) => entry.itemId !== itemId);
      next.push({
        itemId,
        count: (existing?.count ?? 0) + 1,
        lastSearchedAt: new Date().toISOString(),
      });
      write(store, KEYS.searchStats, next);
    },

    async listHistory() {
      return read(store, KEYS.history, [], arrayOf(isTradeRecord));
    },
    async addHistoryRecord(record) {
      const history = read(store, KEYS.history, [], arrayOf(isTradeRecord)).filter(
        (r) => r.id !== record.id,
      );
      history.unshift(record);
      write(store, KEYS.history, history);
    },
    async removeHistoryRecord(id) {
      const history = read(store, KEYS.history, [], arrayOf(isTradeRecord)).filter(
        (r) => r.id !== id,
      );
      write(store, KEYS.history, history);
    },

    async getCachedSnapshot() {
      return read(
        store,
        KEYS.snapshot,
        null,
        (value): value is ValueSnapshot | null => value === null || isSnapshot(value),
      );
    },
    async getSnapshotMeta() {
      return read(
        store,
        KEYS.snapshotMeta,
        null,
        (value): value is SnapshotMeta | null =>
          value === null || isSnapshotMeta(value),
      );
    },
    async readExternalSnapshot() {
      // The browser fallback has no local publish channel.
      return null;
    },
    async saveSnapshot(snapshot: ValueSnapshot) {
      const existing = read(
        store,
        KEYS.snapshotMeta,
        null,
        (value): value is SnapshotMeta | null =>
          value === null || isSnapshotMeta(value),
      );
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

    async recordValueHistory(points) {
      if (points.length === 0) return;
      const existing = read(store, KEYS.valueHistory, [], arrayOf(isHistoryPoint));
      // Dedupe on (itemId, source, revision), mirroring the native INSERT OR IGNORE.
      const seen = new Set(
        existing.map((p) => `${p.itemId}\u0000${p.source}\u0000${p.revision}`),
      );
      for (const p of points) {
        const key = `${p.itemId}\u0000${p.source}\u0000${p.revision}`;
        if (seen.has(key)) continue;
        seen.add(key);
        existing.push(p);
      }
      write(store, KEYS.valueHistory, existing);
    },
    async getValueHistory(itemId, limit) {
      const all = read(store, KEYS.valueHistory, [], arrayOf(isHistoryPoint))
        .filter((p) => p.itemId === itemId)
        .sort(
          (a, b) => a.revision - b.revision || a.recordedAt.localeCompare(b.recordedAt),
        );
      const capped = boundedLimit(limit, MAX_HISTORY_LIMIT);
      if (all.length > capped) {
        return all.slice(all.length - capped);
      }
      return all;
    },
    async getAllValueHistory(limit) {
      const capped = boundedLimit(limit, MAX_ALL_HISTORY_LIMIT);
      return read(store, KEYS.valueHistory, [], arrayOf(isHistoryPoint))
        .sort(
          (a, b) =>
            b.revision - a.revision ||
            b.recordedAt.localeCompare(a.recordedAt) ||
            a.itemId.localeCompare(b.itemId) ||
            a.source.localeCompare(b.source),
        )
        .slice(0, capped)
        .sort(
          (a, b) =>
            a.itemId.localeCompare(b.itemId) ||
            a.revision - b.revision ||
            a.recordedAt.localeCompare(b.recordedAt) ||
            a.source.localeCompare(b.source),
        );
    },

    async getAppInfo() {
      return APP_INFO;
    },
    async clearAllData() {
      for (const key of Object.values(KEYS)) store.removeItem(key);
    },
  };
}
