import { describe, it, expect } from "vitest";
import type { Item, Stability } from "@tradelens/item-schema";
import { evaluateTrade } from "../src/fairness.js";

const now = Date.parse("2026-07-30T12:00:00Z");
const recent = "2026-07-30T10:00:00Z";

interface ItemOpts {
  supreme?: number;
  mm2values?: number;
  demand?: number;
  stability?: Stability;
  rarity?: Item["rarity"];
  trendPercent?: number;
}

function item(id: string, opts: ItemOpts = {}): Item {
  const {
    supreme = 1000,
    mm2values = 1000,
    demand = 3,
    stability = "stable",
    rarity = "godly",
    trendPercent,
  } = opts;
  return {
    id,
    displayName: id,
    aliases: [],
    category: "gun",
    rarity,
    chroma: false,
    values: {
      supreme: { value: supreme, demand, stability, trendPercent, updatedAt: recent },
      mm2values: { value: mm2values, demand, stability, trendPercent, updatedAt: recent },
    },
  };
}

describe("evaluateTrade", () => {
  it("reports a fair trade when both sides are equal", () => {
    const r = evaluateTrade(
      [{ item: item("a"), quantity: 1 }],
      [{ item: item("b"), quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.rawVerdict).toBe("fair");
    expect(Math.abs(r.differencePercent)).toBeLessThan(0.01);
  });

  it("reports a win when the received side is clearly higher", () => {
    const r = evaluateTrade(
      [{ item: item("a", { supreme: 1000, mm2values: 1000 }), quantity: 1 }],
      [{ item: item("b", { supreme: 1100, mm2values: 1100 }), quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.rawVerdict).toBe("win");
    expect(r.difference).toBeCloseTo(100, 5);
  });

  it("reports a big win beyond +15%", () => {
    const r = evaluateTrade(
      [{ item: item("a", { supreme: 1000, mm2values: 1000 }), quantity: 1 }],
      [{ item: item("b", { supreme: 1200, mm2values: 1200 }), quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.rawVerdict).toBe("big-win");
  });

  it("widens the fair band when sources disagree", () => {
    // 10% source disagreement should push the fair band above base 5%.
    const contested = item("c", { supreme: 1000, mm2values: 1100 });
    const r = evaluateTrade(
      [{ item: item("a"), quantity: 1 }],
      [{ item: contested, quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.fairBand).toBeGreaterThan(0.05);
    expect(r.warnings.some((w) => w.kind === "source-disagreement")).toBe(true);
  });

  it("counts quantities and flags duplicates", () => {
    const r = evaluateTrade(
      [{ item: item("a", { supreme: 500, mm2values: 500 }), quantity: 2 }],
      [{ item: item("b", { supreme: 1000, mm2values: 1000 }), quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.your.total).toBeCloseTo(1000, 5);
    expect(r.warnings.some((w) => w.kind === "duplicate")).toBe(true);
  });

  it("applies demand adjustment to shift the practical verdict", () => {
    // Raw equal, but received item has much lower demand.
    const give = item("give", { supreme: 1000, mm2values: 1000, demand: 5 });
    const receive = item("recv", { supreme: 1000, mm2values: 1000, demand: 1 });
    const r = evaluateTrade(
      [{ item: give, quantity: 1 }],
      [{ item: receive, quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.rawVerdict).toBe("fair");
    // Lower demand received => adjusted ratio < 1 => loss-ish.
    expect(["loss", "big-loss"]).toContain(r.adjustedVerdict);
  });

  it("handles an empty give side without dividing by zero", () => {
    const r = evaluateTrade([], [{ item: item("b"), quantity: 1 }], "consensus", now);
    expect(Number.isFinite(r.ratio)).toBe(false);
    expect(r.rawVerdict).toBe("big-win");
  });

  it("records the algorithm version on every result", () => {
    const r = evaluateTrade(
      [{ item: item("a"), quantity: 1 }],
      [{ item: item("b"), quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.algorithmVersion).toBe(1);
  });

  it("adds demand, risk and outlook insights", () => {
    const r = evaluateTrade(
      [{ item: item("give", { supreme: 1000, mm2values: 1000, demand: 2 }), quantity: 1 }],
      [
        {
          item: item("receive", {
            supreme: 1100,
            mm2values: 1100,
            demand: 4,
            trendPercent: 3,
          }),
          quantity: 1,
        },
      ],
      "consensus",
      now,
    );

    expect(r.insights.map((insight) => insight.kind)).toEqual(["demand", "risk", "outlook"]);
    expect(r.insights.find((insight) => insight.kind === "demand")?.label).toBe("Demand rising");
    expect(r.insights.find((insight) => insight.kind === "risk")?.label).toBe("Low risk");
    expect(r.insights.find((insight) => insight.kind === "outlook")?.label).toBe("Likely profit");
  });

  it("does not promise profit when risk is high", () => {
    const r = evaluateTrade(
      [{ item: item("give", { supreme: 1000, mm2values: 1000 }), quantity: 1 }],
      [
        {
          item: item("receive", {
            supreme: 1200,
            mm2values: 1500,
            stability: "volatile",
          }),
          quantity: 1,
        },
      ],
      "consensus",
      now,
    );
    expect(r.insights.find((insight) => insight.kind === "risk")?.label).toBe("Higher risk");
    expect(r.insights.find((insight) => insight.kind === "outlook")?.label).toBe("Possible profit");
  });
});

/** Both sides use equal-source items, so the fair band is exactly ±5%. */
function trade(giveTotal: number, receiveTotal: number) {
  return evaluateTrade(
    [{ item: item("g", { supreme: giveTotal, mm2values: giveTotal }), quantity: 1 }],
    [{ item: item("r", { supreme: receiveTotal, mm2values: receiveTotal }), quantity: 1 }],
    "consensus",
    now,
  );
}

describe("verdict thresholds", () => {
  it("treats exactly +5% as a win (win/fair boundary)", () => {
    expect(trade(1000, 1050).rawVerdict).toBe("win");
    expect(trade(1000, 1049).rawVerdict).toBe("fair");
  });

  it("treats exactly +15% as a big win (big-win/win boundary)", () => {
    expect(trade(1000, 1150).rawVerdict).toBe("big-win");
    expect(trade(1000, 1149).rawVerdict).toBe("win");
  });

  it("treats exactly -5% as a loss (loss/fair boundary)", () => {
    expect(trade(1000, 950).rawVerdict).toBe("loss");
    expect(trade(1000, 951).rawVerdict).toBe("fair");
  });

  it("treats exactly -15% as a big loss (big-loss/loss boundary)", () => {
    expect(trade(1000, 850).rawVerdict).toBe("big-loss");
    expect(trade(1000, 851).rawVerdict).toBe("loss");
  });
});

describe("scale handling", () => {
  it("stays precise and finite with very large trades", () => {
    const r = trade(100_000_000, 115_000_000);
    expect(Number.isFinite(r.your.total)).toBe(true);
    expect(r.your.total).toBe(100_000_000);
    expect(r.rawVerdict).toBe("big-win");
  });

  it("works with low-value trades", () => {
    const r = trade(2, 1);
    expect(r.your.total).toBe(2);
    expect(r.their.total).toBe(1);
    expect(r.rawVerdict).toBe("big-loss");
  });
});

describe("warnings", () => {
  const unvalued: Item = {
    id: "mystery",
    displayName: "Mystery Item",
    aliases: [],
    category: "gun",
    rarity: "godly",
    chroma: false,
    values: {},
  };

  it("does not silently treat unknown items as zero", () => {
    const r = evaluateTrade(
      [{ item: item("a"), quantity: 1 }],
      [{ item: unvalued, quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.hasMissingValues).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.warnings.some((w) => w.kind === "missing-values")).toBe(true);
    expect(r.warnings.some((w) => w.kind === "low-confidence")).toBe(true);
  });

  it("warns when the same item appears on both sides", () => {
    const shared = item("shared");
    const r = evaluateTrade(
      [{ item: shared, quantity: 1 }],
      [{ item: shared, quantity: 1 }],
      "consensus",
      now,
    );
    expect(r.warnings.some((w) => w.kind === "same-item-both-sides")).toBe(true);
  });
});
