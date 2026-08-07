import { create } from "zustand";
import {
  SearchIndex,
  resolveValue,
  detectValueChanges,
  type ValueChange,
} from "@tradelens/trade-engine";
import { safeParseSnapshot } from "@tradelens/item-schema";
import { sampleSnapshot } from "@tradelens/source-adapters/sample";
import { mm2valuesSnapshot } from "@tradelens/source-adapters/mm2values";
import type {
  Favorite,
  Item,
  Settings,
  SnapshotMeta,
  TradeRecord,
  ValueSnapshot,
} from "@/types";
import * as db from "@/database";
import { fetchRemoteSnapshot, type FetchOutcome, type UpdateStatus } from "@/services/updates";import { describeError, logger } from "@/services/logger";
import { toEngineMode } from "@/utils/sourceMode";
import { mergeFavorites } from "@/utils/favorites";
import { recordsToPrune } from "@/utils/history";

/** A favorited item whose resolved value moved between snapshots. */
export interface MovedFavorite {
  item: Item;
  from: number;
  to: number;
  changePercent: number;
}

/** Outcome of an update check, consumed by the auto-update hook and settings UI. */
export interface UpdateResult {
  /** Structured status distinguishing "already current", "offline", etc. */
  status: UpdateStatus;
  updated: boolean;
  revision?: number;
  movedFavorites: MovedFavorite[];
  /** Every item whose value moved by at least the absolute alert threshold. */
  movedItems: ValueChange[];
}

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

const STALE_AFTER_HOURS = 48;

/**
 * The snapshot the app seeds and ships offline. This is the real bundled
 * MM2Values feed, not the illustrative {@link sampleSnapshot}.
 */
const bundledSnapshot = mm2valuesSnapshot as ValueSnapshot;

interface DataState {
  ready: boolean;
  loading: boolean;
  error: string | null;

  snapshot: ValueSnapshot | null;
  snapshotMeta: SnapshotMeta | null;
  items: Item[];
  index: SearchIndex;
  itemMap: Map<string, Item>;

  settings: Settings;
  favorites: Favorite[];
  history: TradeRecord[];

  checking: boolean;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  isSampleData: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  itemById: (id: string) => Item | undefined;

  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (itemId: string, value: number) => Promise<void>;
  clearFavorites: () => Promise<void>;
  importFavorites: (incoming: Favorite[]) => Promise<number>;

  addHistory: (record: TradeRecord) => Promise<void>;
  removeHistory: (id: string) => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  clearAll: () => Promise<void>;
  resetData: () => Promise<void>;

  checkForUpdates: () => Promise<UpdateResult>;
}

function buildIndex(items: Item[]): { index: SearchIndex; itemMap: Map<string, Item> } {
  const itemMap = new Map<string, Item>();
  for (const item of items) itemMap.set(item.id, item);
  return { index: new SearchIndex(items), itemMap };
}

/**
 * Cache of the last search index keyed by snapshot revision. Building the index
 * is the one non-trivial cost when loading data, so it is skipped whenever the
 * revision (and therefore the item set) has not changed — e.g. a refresh that
 * only touched favorites, or an update check that returned "already current".
 */
let indexCache: { revision: number; index: SearchIndex; itemMap: Map<string, Item> } | null = null;

/**
 * Return a search index for a snapshot's items, reusing the cached one when the
 * revision matches so the index is not rebuilt unnecessarily.
 */
function indexForSnapshot(
  snapshot: ValueSnapshot | null,
  items: Item[],
): { index: SearchIndex; itemMap: Map<string, Item> } {
  const revision = snapshot?.revision ?? -1;
  if (indexCache && indexCache.revision === revision) {
    return { index: indexCache.index, itemMap: indexCache.itemMap };
  }
  const built = buildIndex(items);
  indexCache = { revision, ...built };
  return built;
}

/**
 * Read the cached snapshot and validate its structure. Returns null when there
 * is nothing cached, the read fails, or the payload is structurally invalid
 * (corrupted cache) — the caller then falls back to the bundled sample.
 */
async function loadValidSnapshot(): Promise<ValueSnapshot | null> {
  let cached: ValueSnapshot | null;
  try {
    cached = await db.getCachedSnapshot();
  } catch (err) {
    logger.warn("init", "cached snapshot unreadable; using sample", describeError(err));
    return null;
  }
  if (!cached) return null;
  const parsed = safeParseSnapshot(cached);
  if (!parsed.success) {
    logger.warn("init", "cached snapshot is corrupt; using sample", {
      detail: parsed.error.message,
    });
    return null;
  }
  return parsed.data as ValueSnapshot;
}

/**
 * Whether the bundled snapshot is newer than a cached one and should replace
 * it. This lets an app update ship fresh data to users whose local database
 * still holds an older seed (e.g. the previous sample), without waiting for a
 * remote update check. A cached snapshot that is the same age or newer — such
 * as one downloaded from the values feed — is always kept.
 */
function bundledIsNewer(cached: ValueSnapshot): boolean {
  const cachedAt = Date.parse(cached.generatedAt);
  const bundledAt = Date.parse(bundledSnapshot.generatedAt);
  if (Number.isNaN(bundledAt)) return false;
  if (Number.isNaN(cachedAt)) return true;
  return bundledAt > cachedAt;
}

/** True when the active snapshot is the bundled demonstration data, not live values. */
function isSample(snapshot: ValueSnapshot | null): boolean {
  if (!snapshot) return false;
  return (
    snapshot.revision === sampleSnapshot.revision &&
    snapshot.generatedAt === sampleSnapshot.generatedAt
  );
}

/**
 * Resolve a local (no-network) update when no remote values service is
 * configured. Prefers a snapshot published into the app data directory by a
 * values sync (scripts/publish-local), falling back to the values bundled with
 * this build, and only accepts one whose revision is newer than the current
 * cache. A published file that fails schema validation is ignored so a bad drop
 * can never break the update check.
 */
async function resolveLocalUpdate(currentRevision: number): Promise<FetchOutcome> {
  let candidate: ValueSnapshot | null = null;
  try {
    const external = await db.readExternalSnapshot();
    if (external) {
      const parsed = safeParseSnapshot(external);
      if (parsed.success) {
        candidate = parsed.data as ValueSnapshot;
      } else {
        logger.warn("updates", "published snapshot is invalid; ignoring", {
          detail: parsed.error.message,
        });
      }
    }
  } catch (err) {
    logger.warn("updates", "could not read published snapshot", describeError(err));
  }

  if (!candidate || bundledSnapshot.revision > candidate.revision) {
    candidate = bundledSnapshot;
  }

  return candidate.revision > currentRevision
    ? { status: "updated", snapshot: candidate }
    : { status: "already-current", revision: currentRevision };
}

/**
 * Coerce persisted settings back into a valid shape. Corrupted or partial data
 * (e.g. an edited file, an interrupted write, or a value of the wrong type) is
 * repaired field-by-field against the defaults so a bad value can never brick
 * startup or produce nonsensical behaviour.
 */
function sanitizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
  };
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

  return {
    sourceMode: oneOf(
      s.sourceMode,
      ["consensus", "supreme", "mm2values", "compare-both"] as const,
      DEFAULT_SETTINGS.sourceMode,
    ),
    overlaySize: oneOf(
      s.overlaySize,
      ["mini", "trade", "expanded"] as const,
      DEFAULT_SETTINGS.overlaySize,
    ),
    theme: oneOf(s.theme, ["dark", "light"] as const, DEFAULT_SETTINGS.theme),
    notificationsEnabled: bool(s.notificationsEnabled, DEFAULT_SETTINGS.notificationsEnabled),
    notifyThresholdPercent: num(s.notifyThresholdPercent, DEFAULT_SETTINGS.notifyThresholdPercent, 1, 100),
    alertAbsoluteThreshold: num(
      s.alertAbsoluteThreshold,
      DEFAULT_SETTINGS.alertAbsoluteThreshold,
      1,
      1_000_000,
    ),
    disagreementThresholdPercent: num(
      s.disagreementThresholdPercent,
      DEFAULT_SETTINGS.disagreementThresholdPercent,
      1,
      100,
    ),
    offlineMode: bool(s.offlineMode, DEFAULT_SETTINGS.offlineMode),
    historyRetentionLimit: Math.round(
      num(s.historyRetentionLimit, DEFAULT_SETTINGS.historyRetentionLimit, 0, 100_000),
    ),
  };
}

export const useDataStore = create<DataState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,

  snapshot: null,
  snapshotMeta: null,
  items: [],
  ...buildIndex([]),

  settings: DEFAULT_SETTINGS,
  favorites: [],
  history: [],

  checking: false,
  lastCheckedAt: null,
  lastUpdatedAt: null,
  isSampleData: false,

  async init() {
    if (get().ready || get().loading) return;
    set({ loading: true, error: null });
    try {
      // Load each piece defensively: a single corrupted store must not prevent
      // the app from starting. Anything unreadable falls back to a safe default
      // and is logged rather than silently ignored.
      const settings = await db
        .getSettings()
        .then(sanitizeSettings)
        .catch((err) => {
          logger.warn("init", "settings unreadable; using defaults", describeError(err));
          return DEFAULT_SETTINGS;
        });
      const favorites = await db.listFavorites().catch((err) => {
        logger.warn("init", "favorites unreadable; starting empty", describeError(err));
        return [] as Favorite[];
      });
      const history = await db.listHistory().catch((err) => {
        logger.warn("init", "history unreadable; starting empty", describeError(err));
        return [] as TradeRecord[];
      });

      // Load and validate the cached snapshot. If it is missing, unreadable,
      // structurally invalid, or older than the data bundled with this build,
      // fall back to the bundled snapshot so the app stays usable offline and
      // upgrades pick up fresh values even when a stale seed is cached.
      let snapshot = await loadValidSnapshot();
      if (!snapshot || bundledIsNewer(snapshot)) {
        snapshot = bundledSnapshot;
        try {
          await db.saveSnapshot(snapshot);
        } catch (err) {
          logger.error("init", "could not seed bundled snapshot", describeError(err));
        }
      }
      const meta = await db.getSnapshotMeta().catch(() => null);

      set({
        settings,
        favorites,
        history,
        snapshot,
        snapshotMeta: meta,
        items: snapshot.items,
        ...indexForSnapshot(snapshot, snapshot.items),
        isSampleData: isSample(snapshot),
        ready: true,
        loading: false,
      });
    } catch (err) {
      const info = describeError(err);
      logger.error("init", `startup failed: ${info.message}`, { kind: info.kind });
      set({ error: info.message, loading: false });
    }
  },

  async refresh() {
    const [favorites, history, snapshot, meta] = await Promise.all([
      db.listFavorites(),
      db.listHistory(),
      db.getCachedSnapshot(),
      db.getSnapshotMeta(),
    ]);
    const items = snapshot?.items ?? get().items;
    set({
      favorites,
      history,
      snapshot: snapshot ?? get().snapshot,
      snapshotMeta: meta,
      items,
      ...indexForSnapshot(snapshot ?? get().snapshot, items),
      isSampleData: isSample(snapshot ?? get().snapshot),
    });
  },

  itemById(id) {
    return get().itemMap.get(id);
  },

  isFavorite(itemId) {
    return get().favorites.some((f) => f.itemId === itemId);
  },

  async toggleFavorite(itemId, value) {
    const exists = get().isFavorite(itemId);
    if (exists) {
      await db.removeFavorite(itemId);
    } else {
      await db.addFavorite(itemId, value);
    }
    set({ favorites: await db.listFavorites() });
  },

  async clearFavorites() {
    for (const fav of get().favorites) await db.removeFavorite(fav.itemId);
    set({ favorites: await db.listFavorites() });
  },

  async importFavorites(incoming) {
    const existing = get().favorites;
    const { added } = mergeFavorites(existing, incoming);
    const existingIds = new Set(existing.map((f) => f.itemId));
    for (const fav of incoming) {
      if (!existingIds.has(fav.itemId)) {
        await db.addFavorite(fav.itemId, fav.baselineValue);
        existingIds.add(fav.itemId);
      }
    }
    set({ favorites: await db.listFavorites() });
    return added;
  },

  async addHistory(record) {
    await db.addHistoryRecord(record);
    let history = await db.listHistory();
    // Enforce the optional retention limit: drop the oldest records beyond it.
    const prune = recordsToPrune(history, get().settings.historyRetentionLimit);
    if (prune.length > 0) {
      for (const id of prune) await db.removeHistoryRecord(id);
      history = await db.listHistory();
    }
    set({ history });
  },

  async removeHistory(id) {
    await db.removeHistoryRecord(id);
    set({ history: await db.listHistory() });
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    await db.updateSettings(next);
    set({ settings: next });
  },

  async clearAll() {
    await db.clearAllData();
    await get().refresh();
    set({ settings: await db.getSettings() });
  },

  async resetData() {
    // Full recovery reset: rebuild the database, then reload everything and
    // re-seed the bundled snapshot so the app remains usable offline.
    await db.resetDatabase();
    const [settings, favorites, history] = await Promise.all([
      db.getSettings(),
      db.listFavorites(),
      db.listHistory(),
    ]);
    let snapshot = await db.getCachedSnapshot();
    if (!snapshot) {
      snapshot = bundledSnapshot;
      await db.saveSnapshot(snapshot);
    }
    const meta = await db.getSnapshotMeta();
    set({
      settings,
      favorites,
      history,
      snapshot,
      snapshotMeta: meta,
      items: snapshot.items,
      ...indexForSnapshot(snapshot, snapshot.items),
      isSampleData: isSample(snapshot),
    });
  },

  async checkForUpdates() {
    const { settings, checking } = get();
    if (settings.offlineMode) {
      return { status: "disabled", updated: false, movedFavorites: [], movedItems: [] };
    }
    // Prevent overlapping requests: a check already in flight wins.
    if (checking) {
      return { status: "already-current", updated: false, movedFavorites: [], movedItems: [] };
    }
    set({ checking: true });
    const now = () => new Date().toISOString();
    try {
      const current = get().snapshot;
      const currentRevision = current?.revision ?? -1;
      let outcome = await fetchRemoteSnapshot(undefined, undefined, currentRevision);

      // Offline-first fallback: when no remote values service is configured for
      // this build, values reach an installed app through two local channels —
      // a snapshot published into the app data directory by a values sync
      // (scripts/publish-local), and the values bundled with the build. Adopt
      // whichever is newest instead of dead-ending on "no values service".
      if (outcome.status === "not-configured") {
        outcome = await resolveLocalUpdate(currentRevision);
      }

      if (outcome.status !== "updated") {
        set({ checking: false, lastCheckedAt: now() });
        return { status: outcome.status, updated: false, movedFavorites: [], movedItems: [] };
      }

      const remote = outcome.snapshot;

      // Capture prior resolved values for favorites so we can report movement.
      const mode = toEngineMode(get().settings.sourceMode);
      const prevMap = get().itemMap;
      const prevFavValues = new Map<string, number>();
      for (const fav of get().favorites) {
        const prevItem = prevMap.get(fav.itemId);
        const resolved = prevItem ? resolveValue(prevItem, mode) : undefined;
        if (resolved) prevFavValues.set(fav.itemId, resolved.value);
      }

      // Caching the snapshot is the one step that can fail locally (disk/DB).
      // Surface that distinctly from a network problem and keep the old data.
      try {
        await db.saveSnapshot(remote);
      } catch (err) {
        const info = describeError(err);
        logger.error("updates", `failed to cache revision ${remote.revision}`, info);
        set({ checking: false, lastCheckedAt: now() });
        return { status: "database-error", updated: false, movedFavorites: [], movedItems: [] };
      }

      const meta = await db.getSnapshotMeta();
      const { index, itemMap } = indexForSnapshot(remote, remote.items);
      const stamp = now();
      set({
        snapshot: remote,
        snapshotMeta: meta,
        items: remote.items,
        index,
        itemMap,
        checking: false,
        lastCheckedAt: stamp,
        lastUpdatedAt: stamp,
        isSampleData: isSample(remote),
      });
      logger.info("updates", `applied revision ${remote.revision}`);

      const movedFavorites: MovedFavorite[] = [];
      for (const fav of get().favorites) {
        const from = prevFavValues.get(fav.itemId);
        const nextItem = itemMap.get(fav.itemId);
        const resolved = nextItem ? resolveValue(nextItem, mode) : undefined;
        if (from === undefined || !resolved || from === 0) continue;
        const changePercent = ((resolved.value - from) / from) * 100;
        if (changePercent !== 0) {
          movedFavorites.push({ item: nextItem!, from, to: resolved.value, changePercent });
        }
      }

      // Market-wide movement: every item (any rarity) that shifted by at least
      // the user's absolute alert threshold since the previous snapshot.
      const movedItems = current
        ? detectValueChanges(
            current.items,
            remote.items,
            mode,
            get().settings.alertAbsoluteThreshold,
          )
        : [];

      return {
        status: "updated",
        updated: true,
        revision: remote.revision,
        movedFavorites,
        movedItems,
      };
    } catch (err) {
      const info = describeError(err);
      logger.error("updates", `unexpected error during update check: ${info.message}`, {
        kind: info.kind,
      });
      set({ checking: false, lastCheckedAt: now() });
      return { status: "network-error", updated: false, movedFavorites: [], movedItems: [] };
    }
  },
}));

/** True when the cached snapshot is older than the staleness threshold. */
export function snapshotIsStale(meta: SnapshotMeta | null): boolean {
  if (!meta) return false;
  const t = Date.parse(meta.generatedAt);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) / (1000 * 60 * 60) > STALE_AFTER_HOURS;
}
