import { describe, expect, it } from "vitest";
import type { Settings, TradeRecord, ValueSnapshot } from "@/types";
import { createBrowserStorage } from "./browserAdapter";
import { isTauriRuntime } from "./runtime";

/** Minimal in-memory implementation of the Web Storage API for tests. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

const snapshot = (revision: number): ValueSnapshot =>
  ({
    schemaVersion: 1,
    revision,
    generatedAt: "2026-07-31T00:00:00.000Z",
    sources: ["supreme"],
    items: [
      {
        id: "seer",
        displayName: "Seer",
        aliases: [],
        category: "gun",
        rarity: "godly",
        chroma: false,
        verified: true,
        values: { supreme: { value: 40, updatedAt: "2026-07-31T00:00:00.000Z" } },
      },
    ],
  }) as unknown as ValueSnapshot;

describe("browser storage adapter", () => {
  it("reports its kind", () => {
    expect(createBrowserStorage(memoryStorage()).kind).toBe("browser");
  });

  it("round-trips settings", async () => {
    const store = createBrowserStorage(memoryStorage());
    const next: Settings = {
      sourceMode: "compare-both",
      overlaySize: "expanded",
      alwaysOnTop: false,
      theme: "light",
      notificationsEnabled: true,
      notifyThresholdPercent: 12,
      alertAbsoluteThreshold: 25,
      disagreementThresholdPercent: 8,
      offlineMode: true,
      historyRetentionLimit: 50,
    };
    await store.updateSettings(next);
    expect(await store.getSettings()).toEqual(next);
  });

  it("returns default settings before anything is saved", async () => {
    const settings = await createBrowserStorage(memoryStorage()).getSettings();
    expect(settings.sourceMode).toBe("consensus");
    expect(settings.theme).toBe("dark");
  });

  it("falls back safely when stored JSON has the wrong shape", async () => {
    const backing = memoryStorage();
    backing.setItem("tradelens:settings", "[]");
    backing.setItem("tradelens:favorites", '{"not":"an array"}');
    backing.setItem("tradelens:history", '[{"id":3}]');
    backing.setItem("tradelens:snapshot-meta", '{"revision":"new"}');
    const store = createBrowserStorage(backing);

    expect((await store.getSettings()).sourceMode).toBe("consensus");
    expect(await store.listFavorites()).toEqual([]);
    expect(await store.listHistory()).toEqual([]);
    expect(await store.getSnapshotMeta()).toBeNull();
    await expect(store.addFavorite("seer", 40)).resolves.toBeUndefined();
  });

  it("adds, dedupes and removes favorites", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.addFavorite("seer", 40);
    await store.addFavorite("seer", 45); // replaces, does not duplicate
    let favorites = await store.listFavorites();
    expect(favorites).toHaveLength(1);
    expect(favorites[0]).toMatchObject({ itemId: "seer", baselineValue: 45 });

    await store.removeFavorite("seer");
    favorites = await store.listFavorites();
    expect(favorites).toHaveLength(0);
  });

  it("round-trips history records newest-first", async () => {
    const store = createBrowserStorage(memoryStorage());
    const rec = (id: string): TradeRecord => ({
      id,
      date: "2026-07-31T00:00:00.000Z",
      gave: [{ itemId: "seer", quantity: 1 }],
      received: [{ itemId: "chroma-seer", quantity: 1 }],
      resultPercent: 0,
      mode: "consensus",
    });
    await store.addHistoryRecord(rec("a"));
    await store.addHistoryRecord(rec("b"));
    const history = await store.listHistory();
    expect(history.map((h) => h.id)).toEqual(["b", "a"]);

    await store.removeHistoryRecord("a");
    expect((await store.listHistory()).map((h) => h.id)).toEqual(["b"]);
  });

  it("persists portfolio quantities and search analytics", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.upsertPortfolioEntry("harvester", 2, 100);
    await store.upsertPortfolioEntry("harvester", 3, 100);
    expect(await store.listPortfolio()).toMatchObject([
      { itemId: "harvester", quantity: 3, baselineValue: 100 },
    ]);
    await store.recordSearch("harvester");
    await store.recordSearch("harvester");
    expect(await store.listSearchStats()).toMatchObject([
      { itemId: "harvester", count: 2 },
    ]);
    await store.removePortfolioEntry("harvester");
    expect(await store.listPortfolio()).toEqual([]);
  });

  it("caches a snapshot and rejects downgrades", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.saveSnapshot(snapshot(2));
    expect((await store.getCachedSnapshot())?.revision).toBe(2);
    expect((await store.getSnapshotMeta())?.revision).toBe(2);

    await expect(store.saveSnapshot(snapshot(1))).rejects.toThrow(/refusing to cache/);
    await expect(store.saveSnapshot(snapshot(2))).rejects.toThrow(/refusing to cache/);
    await store.saveSnapshot(snapshot(3));
    expect((await store.getCachedSnapshot())?.revision).toBe(3);
  });

  it("records value history, dedupes revisions and reads it back oldest-first", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.recordValueHistory([
      {
        itemId: "seer",
        source: "supreme",
        value: 320,
        recordedAt: "2024-08-01T00:00:00Z",
        revision: 5,
      },
      {
        itemId: "seer",
        source: "supreme",
        value: 315,
        recordedAt: "2024-08-02T00:00:00Z",
        revision: 6,
      },
    ]);
    // Re-recording the same revision is ignored; a new revision is appended.
    await store.recordValueHistory([
      {
        itemId: "seer",
        source: "supreme",
        value: 999,
        recordedAt: "2024-08-02T00:00:00Z",
        revision: 6,
      },
      {
        itemId: "seer",
        source: "supreme",
        value: 330,
        recordedAt: "2024-08-03T00:00:00Z",
        revision: 7,
      },
    ]);

    const history = await store.getValueHistory("seer");
    expect(history.map((p) => p.revision)).toEqual([5, 6, 7]);
    expect(history.map((p) => p.value)).toEqual([320, 315, 330]);
    expect(await store.getValueHistory("nope")).toHaveLength(0);

    const capped = await store.getValueHistory("seer", 2);
    expect(capped.map((p) => p.revision)).toEqual([6, 7]);
  });

  it("caps all-item history by the newest revisions globally", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.recordValueHistory([
      {
        itemId: "z-old",
        source: "supreme",
        value: 1,
        recordedAt: "2024-01-01T00:00:00Z",
        revision: 1,
      },
      {
        itemId: "a-new",
        source: "supreme",
        value: 2,
        recordedAt: "2024-01-03T00:00:00Z",
        revision: 3,
      },
      {
        itemId: "m-mid",
        source: "supreme",
        value: 3,
        recordedAt: "2024-01-02T00:00:00Z",
        revision: 2,
      },
    ]);

    const capped = await store.getAllValueHistory(2);
    expect(capped.map((p) => p.revision).sort((a, b) => a - b)).toEqual([2, 3]);
    expect((await store.getAllValueHistory(0)).length).toBe(1);
  });

  it("clears all data", async () => {
    const backing = memoryStorage();
    const store = createBrowserStorage(backing);
    await store.updateSettings(await store.getSettings());
    await store.addFavorite("seer", 40);
    await store.saveSnapshot(snapshot(1));
    await store.clearAllData();
    expect(backing.length).toBe(0);
    expect(await store.listFavorites()).toHaveLength(0);
    expect(await store.getCachedSnapshot()).toBeNull();
  });
});

describe("runtime detection", () => {
  it("reports false outside the Tauri shell", () => {
    expect(isTauriRuntime()).toBe(false);
  });
});
