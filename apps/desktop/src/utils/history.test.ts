import { describe, it, expect } from "vitest";
import type { Item, TradeRecord } from "@/types";
import {
  verdictFromPercent,
  verdictForRecord,
  filterHistory,
  exportHistory,
  applyRetention,
  recordsToPrune,
} from "./history";

function record(
  id: string,
  resultPercent: number,
  opts: Partial<TradeRecord> = {},
): TradeRecord {
  return {
    id,
    date: `2026-07-${id.padStart(2, "0")}T00:00:00.000Z`,
    gave: [{ itemId: "seer", quantity: 1 }],
    received: [{ itemId: "chroma-seer", quantity: 1 }],
    resultPercent,
    mode: "consensus",
    ...opts,
  };
}

const items: Record<string, Item> = {
  seer: { id: "seer", displayName: "Seer" } as Item,
  "chroma-seer": { id: "chroma-seer", displayName: "Chroma Seer" } as Item,
};
const nameOf = (id: string): Item | undefined => items[id];

describe("verdictFromPercent", () => {
  it("buckets percentages into verdicts", () => {
    expect(verdictFromPercent(20)).toBe("big-win");
    expect(verdictFromPercent(8)).toBe("win");
    expect(verdictFromPercent(0)).toBe("fair");
    expect(verdictFromPercent(-8)).toBe("loss");
    expect(verdictFromPercent(-20)).toBe("big-loss");
  });
});

describe("verdictForRecord", () => {
  it("prefers the frozen adjusted verdict over percentage rebucketing", () => {
    const saved = record("20", 12, {
      calculation: { adjustedVerdict: "loss" } as TradeRecord["calculation"],
    });
    expect(verdictFromPercent(saved.resultPercent)).toBe("win");
    expect(verdictForRecord(saved)).toBe("loss");
  });
});

describe("filterHistory", () => {
  const history = [
    record("10", 20, { mode: "consensus" }),
    record("11", 0, { mode: "supreme" }),
    record("12", -20, { mode: "consensus" }),
  ];

  it("returns everything with an empty filter", () => {
    expect(filterHistory(history, {}, nameOf)).toHaveLength(3);
  });

  it("filters by outcome group", () => {
    expect(
      filterHistory(history, { outcome: "wins" }, nameOf).map((r) => r.id),
    ).toEqual(["10"]);
    expect(
      filterHistory(history, { outcome: "losses" }, nameOf).map((r) => r.id),
    ).toEqual(["12"]);
    expect(
      filterHistory(history, { outcome: "fair" }, nameOf).map((r) => r.id),
    ).toEqual(["11"]);
  });

  it("filters using the frozen verdict when available", () => {
    const frozenLoss = record("14", 20, {
      calculation: { adjustedVerdict: "loss" } as TradeRecord["calculation"],
    });
    expect(filterHistory([frozenLoss], { outcome: "wins" }, nameOf)).toEqual([]);
    expect(filterHistory([frozenLoss], { outcome: "losses" }, nameOf)).toEqual([
      frozenLoss,
    ]);
  });

  it("filters by source mode", () => {
    expect(
      filterHistory(history, { mode: "supreme" }, nameOf).map((r) => r.id),
    ).toEqual(["11"]);
  });

  it("matches free-text against item display names", () => {
    expect(filterHistory(history, { query: "chroma" }, nameOf)).toHaveLength(3);
    expect(filterHistory(history, { query: "nothing" }, nameOf)).toHaveLength(0);
  });

  it("matches against the raw id so retired items stay findable", () => {
    const retired = [
      record("13", 0, { gave: [{ itemId: "retired-blade", quantity: 1 }] }),
    ];
    expect(filterHistory(retired, { query: "retired-blade" }, nameOf)).toHaveLength(1);
  });
});

describe("exportHistory", () => {
  it("wraps records in a versioned envelope", () => {
    const json = exportHistory([record("10", 5)], new Date("2026-07-31T00:00:00.000Z"));
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe("tradelens-history");
    expect(parsed.version).toBe(1);
    expect(parsed.history).toHaveLength(1);
  });
});

describe("retention", () => {
  const history = [record("13", 0), record("12", 0), record("11", 0), record("10", 0)];

  it("keeps the newest N with a positive limit", () => {
    expect(applyRetention(history, 2).map((r) => r.id)).toEqual(["13", "12"]);
  });

  it("treats 0 or negative as unlimited", () => {
    expect(applyRetention(history, 0)).toHaveLength(4);
    expect(applyRetention(history, -5)).toHaveLength(4);
  });

  it("reports ids to prune beyond the limit", () => {
    expect(recordsToPrune(history, 2)).toEqual(["11", "10"]);
    expect(recordsToPrune(history, 0)).toEqual([]);
    expect(recordsToPrune(history, 10)).toEqual([]);
  });
});
