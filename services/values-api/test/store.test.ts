import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { mm2valuesSnapshot } from "@tradelens/source-adapters/mm2values";
import { SnapshotStore, store } from "../src/store.js";

describe("values-api snapshot store", () => {
  it("serves the current snapshot with a checksum", () => {
    const { snapshot, checksum } = store.get();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.items.length).toBeGreaterThan(0);
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("looks up a single item by id", () => {
    const first = store.get().snapshot.items[0]!;
    expect(store.getItem(first.id)?.id).toBe(first.id);
    expect(store.getItem("does-not-exist")).toBeUndefined();
  });

  it("does not sign when no key is configured", () => {
    // Tests run without TRADELENS_SIGNING_KEY set.
    expect(store.getSigned()).toBeUndefined();
    expect(store.getPublicKey()).toBeUndefined();
  });

  it("bumps the revision on admin import", () => {
    const before = store.get().snapshot.revision;
    const next = store.importRows({
      supreme: [
        {
          name: "Seer",
          category: "gun",
          rarity: "godly",
          value: 40,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(next.revision).toBe(before + 1);
    expect(next.items.some((i) => i.id === "seer")).toBe(true);
  });

  it("stages a candidate for review without publishing it", () => {
    const current = store.get().snapshot.revision;
    const { revision, audit } = store.stageRows({
      supreme: [
        {
          name: "Staged Item",
          category: "gun",
          rarity: "godly",
          value: 10,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    // The published snapshot is unchanged until publish is called.
    expect(store.get().snapshot.revision).toBe(current);
    expect(revision).toBe(current + 1);
    expect(store.getStaged()?.revision).toBe(revision);
    expect(audit.itemCount).toBe(1);
  });

  it("publishes the staged candidate and can roll it back", () => {
    const before = store.get().snapshot;
    store.stageRows({
      mm2values: [
        {
          name: "Reviewed Item",
          category: "knife",
          rarity: "ancient",
          value: 25,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const published = store.publish();
    expect(published.revision).toBe(before.revision + 1);
    expect(store.getStaged()).toBeUndefined();
    expect(store.get().snapshot.items.some((i) => i.id === "reviewed-item")).toBe(true);

    expect(store.canRollback()).toBe(true);
    const restored = store.rollback();
    expect(restored.revision).toBe(published.revision + 1);
    expect(restored.items.some((i) => i.id === "reviewed-item")).toBe(false);
  });

  it("persists published state and rollback history across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "tradelens-values-"));
    const file = join(dir, "state.json");
    try {
      const first = new SnapshotStore(mm2valuesSnapshot, undefined, file);
      const initialRevision = first.get().snapshot.revision;
      first.importRows({
        supreme: [{
          name: "Durable Item",
          category: "gun",
          rarity: "godly",
          value: 42,
          updatedAt: new Date().toISOString(),
        }],
      });

      const restarted = new SnapshotStore(mm2valuesSnapshot, undefined, file);
      expect(restarted.get().snapshot.revision).toBe(initialRevision + 1);
      expect(restarted.getItem("durable-item")?.values.supreme?.value).toBe(42);
      expect(restarted.canRollback()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to publish nothing, and refuses rollback with no history", () => {
    store.discardStaged();
    expect(() => store.publish()).toThrow();
    // Drain any accumulated history so rollback has nothing to restore.
    while (store.canRollback()) store.rollback();
    expect(() => store.rollback()).toThrow();
  });
});
