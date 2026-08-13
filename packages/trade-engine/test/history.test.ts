import { describe, it, expect } from "vitest";
import type { Item } from "@tradelens/item-schema";
import { evaluateTrade } from "../src/fairness.js";
import { toTradeCalculation } from "../src/history.js";

const now = Date.parse("2026-07-30T12:00:00Z");
const recent = "2026-07-30T10:00:00Z";

function item(id: string, supreme: number, mm2values: number): Item {
  return {
    id,
    displayName: id.toUpperCase(),
    aliases: [],
    category: "gun",
    rarity: "godly",
    chroma: false,
    values: {
      supreme: { value: supreme, demand: 3, stability: "stable", updatedAt: recent },
      mm2values: { value: mm2values, demand: 3, stability: "stable", updatedAt: recent },
    },
  };
}

describe("toTradeCalculation", () => {
  it("captures totals, verdicts and thresholds", () => {
    const result = evaluateTrade(
      [{ item: item("seer", 100, 100), quantity: 1 }],
      [{ item: item("chroma", 130, 130), quantity: 1 }],
      "consensus",
      now,
    );
    const calc = toTradeCalculation(result);

    expect(calc.algorithmVersion).toBe(result.algorithmVersion);
    expect(calc.mode).toBe("consensus");
    expect(calc.yourTotal).toBe(result.your.total);
    expect(calc.theirTotal).toBe(result.their.total);
    expect(calc.rawVerdict).toBe(result.rawVerdict);
    expect(calc.adjustedVerdict).toBe(result.adjustedVerdict);
    expect(calc.thresholds.fairBand).toBe(result.fairBand);
    expect(calc.thresholds.bigBand).toBeGreaterThan(0);
    expect(calc.explanation).toBe(result.explanation);
    expect(calc.insights).toEqual(result.insights);
  });

  it("freezes exact per-source readings and resolved values", () => {
    const result = evaluateTrade(
      [{ item: item("seer", 100, 120), quantity: 2 }],
      [{ item: item("chroma", 200, 200), quantity: 1 }],
      "consensus",
      now,
    );
    const calc = toTradeCalculation(result);

    const gave = calc.gave[0]!;
    expect(gave.itemId).toBe("seer");
    expect(gave.displayName).toBe("SEER");
    expect(gave.quantity).toBe(2);
    expect(gave.lineValue).toBe(gave.unitValue * 2);
    expect(gave.readings).toEqual([
      { source: "supreme", value: 100 },
      { source: "mm2values", value: 120 },
    ]);
    expect(gave.disagreement).toBeGreaterThan(0);
    expect(gave.unvalued).toBe(false);
  });

  it("records warnings shown at the time", () => {
    const result = evaluateTrade(
      [{ item: item("seer", 100, 100), quantity: 1 }],
      // Missing values under a source the item does not have → a warning.
      [{ item: item("ghost", 100, 100), quantity: 3 }],
      "consensus",
      now,
    );
    const calc = toTradeCalculation(result);
    expect(calc.warnings.map((w) => w.kind)).toEqual(result.warnings.map((w) => w.kind));
  });

  it("marks a line as unvalued when the source has no reading", () => {
    const noValue: Item = {
      id: "mystery",
      displayName: "Mystery",
      aliases: [],
      category: "other",
      rarity: "godly",
      chroma: false,
      values: {},
    };
    const result = evaluateTrade(
      [{ item: noValue, quantity: 1 }],
      [{ item: item("chroma", 100, 100), quantity: 1 }],
      "consensus",
      now,
    );
    const calc = toTradeCalculation(result);
    expect(calc.gave[0]!.unvalued).toBe(true);
    expect(calc.gave[0]!.readings).toEqual([]);
  });

  it("produces a JSON-serialisable structure", () => {
    const result = evaluateTrade(
      [{ item: item("seer", 100, 100), quantity: 1 }],
      [{ item: item("chroma", 110, 110), quantity: 1 }],
      "consensus",
      now,
    );
    const calc = toTradeCalculation(result);
    expect(() => JSON.parse(JSON.stringify(calc))).not.toThrow();
    expect(JSON.parse(JSON.stringify(calc))).toEqual(calc);
  });
});
