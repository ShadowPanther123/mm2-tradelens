import { describe, expect, it } from "vitest";
import { safeParseSnapshot } from "@tradelens/item-schema";
import type { ValueSnapshot } from "@/types";
import { createBrowserStorage } from "./browserAdapter";

/** Minimal in-memory Web Storage used to drive the adapter without a DOM. */
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

const snapshot = (revision: number, value = 40): ValueSnapshot =>
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
        values: { supreme: { value, updatedAt: "2026-07-31T00:00:00.000Z" } },
      },
    ],
  }) as unknown as ValueSnapshot;

/**
 * End-to-end snapshot lifecycle at the persistence boundary: bootstrap from the
 * bundled sample, apply a valid newer remote snapshot, reject an invalid one,
 * and confirm the last-known-good copy remains (rollback safety).
 */
describe("snapshot lifecycle (integration)", () => {
  it("bootstraps from the first sample snapshot", async () => {
    const store = createBrowserStorage(memoryStorage());
    expect(await store.getCachedSnapshot()).toBeNull();

    await store.saveSnapshot(snapshot(1));
    const cached = await store.getCachedSnapshot();
    expect(cached?.revision).toBe(1);
    expect((await store.getSnapshotMeta())?.revision).toBe(1);
  });

  it("replaces the sample with a valid newer remote snapshot", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.saveSnapshot(snapshot(1, 40));
    await store.saveSnapshot(snapshot(2, 55));

    const cached = await store.getCachedSnapshot();
    expect(cached?.revision).toBe(2);
    expect(cached?.items[0]?.values.supreme?.value).toBe(55);
  });

  it("rejects an invalid snapshot before it can be cached", () => {
    const broken = { schemaVersion: 1, revision: 3, items: "not-an-array" };
    const parsed = safeParseSnapshot(broken);
    expect(parsed.success).toBe(false);
  });

  it("keeps the last-known-good snapshot when a broken one is refused", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.saveSnapshot(snapshot(1, 40));
    await store.saveSnapshot(snapshot(2, 55));

    // A downgrade/replay is refused, so the good rev 2 stays in place (rollback).
    await expect(store.saveSnapshot(snapshot(2, 999))).rejects.toThrow(/refusing to cache/);
    await expect(store.saveSnapshot(snapshot(1, 999))).rejects.toThrow(/refusing to cache/);

    const cached = await store.getCachedSnapshot();
    expect(cached?.revision).toBe(2);
    expect(cached?.items[0]?.values.supreme?.value).toBe(55);
  });

  it("preserves favorites and history across a snapshot refresh", async () => {
    const store = createBrowserStorage(memoryStorage());
    await store.addFavorite("seer", 40);
    await store.addHistoryRecord({
      id: "t1",
      date: "2026-07-31T00:00:00.000Z",
      gave: [{ itemId: "seer", quantity: 1 }],
      received: [{ itemId: "chroma-seer", quantity: 1 }],
      resultPercent: 0,
      mode: "consensus",
    });

    await store.saveSnapshot(snapshot(1));
    await store.saveSnapshot(snapshot(2));

    expect(await store.listFavorites()).toHaveLength(1);
    expect((await store.listHistory()).map((h) => h.id)).toEqual(["t1"]);
  });
});
