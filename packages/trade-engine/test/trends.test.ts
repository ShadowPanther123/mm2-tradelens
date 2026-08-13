import { describe, it, expect } from "vitest";
import type { Item, SourceValue } from "@tradelens/item-schema";
import {
  biggestAbsoluteMovers,
  historyMovers,
  latestSyncMovers,
  mergeHistoryReadings,
  snapshotHistory,
  type HistoryReading,
} from "../src/trends.js";

const updated = "2026-08-10T00:00:00Z";
const now = Date.parse("2026-08-10T12:00:00Z");

function reading(value: number): SourceValue {
  return { value, demand: 3, stability: "stable", updatedAt: updated };
}

function item(id: string, value: number): Item {
  return {
    id,
    displayName: id,
    aliases: [],
    category: "gun",
    rarity: "godly",
    chroma: false,
    values: { mm2values: reading(value) },
  };
}

function point(
  revision: number,
  value: number,
  daysAgo: number,
  source: "mm2values" | "supreme" = "mm2values",
): HistoryReading {
  return {
    source,
    value,
    revision,
    recordedAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  };
}

describe("historyMovers", () => {
  it("computes movement across a multi-revision window and returns a full series", () => {
    const items = [item("riser", 120)];
    const history = new Map<string, HistoryReading[]>([
      ["riser", [point(10, 100, 6), point(11, 110, 3), point(12, 120, 1)]],
    ]);
    const [mover] = historyMovers(items, history, "mm2values", { days: 7, now });
    expect(mover.item.id).toBe("riser");
    expect(mover.series).toEqual([100, 110, 120]);
    expect(mover.previousValue).toBe(100);
    expect(mover.value).toBe(120);
    expect(mover.changeAbsolute).toBe(20);
    expect(mover.changePercent).toBeCloseTo(20);
  });

  it("uses the last reading before the day window as its baseline", () => {
    const items = [item("old", 200)];
    const history = new Map<string, HistoryReading[]>([
      // The last known value before the window is the baseline for the first
      // reading inside it, even when no point landed exactly on the cutoff.
      ["old", [point(1, 100, 30), point(2, 200, 5), point(3, 200, 1)]],
    ]);
    const [mover] = historyMovers(items, history, "mm2values", { days: 7, now });
    expect(mover.series).toEqual([100, 200, 200]);
    expect(mover.changeAbsolute).toBe(100);
  });

  it("filters by direction", () => {
    const items = [item("up", 150), item("down", 50)];
    const history = new Map<string, HistoryReading[]>([
      ["up", [point(1, 100, 5), point(2, 150, 1)]],
      ["down", [point(1, 100, 5), point(2, 50, 1)]],
    ]);
    expect(
      historyMovers(items, history, "mm2values", { direction: "up", now }).map((m) => m.item.id),
    ).toEqual(["up"]);
    expect(
      historyMovers(items, history, "mm2values", { direction: "down", now }).map((m) => m.item.id),
    ).toEqual(["down"]);
  });

  it("ignores a different source's readings", () => {
    const items = [item("x", 100)];
    const history = new Map<string, HistoryReading[]>([
      ["x", [point(1, 100, 5, "supreme"), point(2, 200, 1, "supreme")]],
    ]);
    expect(historyMovers(items, history, "mm2values", { now })).toHaveLength(0);
  });

  it("caps each window to the most recent maxPoints readings", () => {
    const items = [item("m", 130)];
    const history = new Map<string, HistoryReading[]>([
      ["m", [point(1, 100, 8), point(2, 110, 5), point(3, 130, 1)]],
    ]);
    const [mover] = historyMovers(items, history, "mm2values", { maxPoints: 2, now });
    expect(mover.series).toEqual([110, 130]);
    expect(mover.previousValue).toBe(110);
  });

  it("sorts by absolute percentage change and respects the limit", () => {
    const items = [item("small", 110), item("big", 300)];
    const history = new Map<string, HistoryReading[]>([
      ["small", [point(1, 100, 5), point(2, 110, 1)]], // +10%
      ["big", [point(1, 100, 5), point(2, 300, 1)]], // +200%
    ]);
    const result = historyMovers(items, history, "mm2values", { limit: 1, now });
    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe("big");
  });
});

describe("mergeHistoryReadings", () => {
  it("preserves embedded history when local history only has recent points", () => {
    const merged = mergeHistoryReadings(
      [point(1, 100, 10), point(2, 110, 5)],
      [point(20, 110, 5), point(21, 125, 1)],
    );
    expect(merged.map((p) => p.value)).toEqual([100, 110, 125]);
  });
});

describe("latestSyncMovers", () => {
  it("ranks only the newest sync delta while retaining the historical graph", () => {
    const current = item("current", 130);
    current.values.mm2values = {
      ...current.values.mm2values,
      previousValue: 120,
      trendPercent: 8.33,
    };
    const stale = item("stale", 200);
    const items = [current, stale];
    const history = new Map<string, HistoryReading[]>([
      ["current", [point(1, 100, 6), point(2, 120, 3), point(3, 130, 1)]],
      ["stale", [point(1, 100, 6), point(2, 200, 1)]],
    ]);

    const result = latestSyncMovers(items, history, "mm2values", { days: 7, now });

    expect(result.map((mover) => mover.item.id)).toEqual(["current"]);
    expect(result[0].previousValue).toBe(120);
    expect(result[0].value).toBe(130);
    expect(result[0].series).toEqual([100, 120, 130]);
  });
});

describe("biggestAbsoluteMovers", () => {
  it("ranks by raw value moved rather than percentage", () => {
    const items = [item("pct", 2), item("abs", 11000)];
    const history = new Map<string, HistoryReading[]>([
      ["pct", [point(1, 1, 5), point(2, 2, 1)]], // +100% but only +1
      ["abs", [point(1, 10000, 5), point(2, 11000, 1)]], // +10% but +1000
    ]);
    const result = biggestAbsoluteMovers(items, history, "mm2values", { now });
    expect(result[0].item.id).toBe("abs");
    expect(result[0].changeAbsolute).toBe(1000);
  });
});

describe("snapshotHistory", () => {
  it("reads the rolling history series embedded in a reading", () => {
    const items: Item[] = [
      {
        id: "riser",
        displayName: "riser",
        aliases: [],
        category: "gun",
        rarity: "godly",
        chroma: false,
        values: {
          mm2values: {
            value: 130,
            updatedAt: updated,
            history: [
              { value: 100, at: updated },
              { value: 130, at: updated },
            ],
          },
        },
      },
    ];
    const map = snapshotHistory(items, "mm2values");
    expect(map.get("riser")?.map((r) => r.value)).toEqual([100, 130]);
  });

  it("synthesises a two-point series from previousValue when no history exists", () => {
    const items = [
      {
        ...item("mover", 120),
        values: { mm2values: { value: 120, previousValue: 100, updatedAt: updated } },
      } as Item,
    ];
    const map = snapshotHistory(items, "mm2values");
    expect(map.get("mover")?.map((r) => r.value)).toEqual([100, 120]);
  });

  it("omits flat readings that never moved", () => {
    const map = snapshotHistory([item("flat", 50)], "mm2values");
    expect(map.has("flat")).toBe(false);
  });
});
