import { describe, it, expect } from "vitest";
import type { Item, SourceValue, Stability } from "@tradelens/item-schema";
import { resolveValue, roundValue, sourceModeLabel } from "../src/values.js";

const now = Date.parse("2026-07-30T12:00:00Z");
const recent = "2026-07-30T10:00:00Z";
const old = "2026-07-01T10:00:00Z"; // > 48h before `now`

function reading(value: number, opts: Partial<SourceValue> = {}): SourceValue {
  return {
    value,
    demand: opts.demand ?? 3,
    stability: opts.stability ?? "stable",
    updatedAt: opts.updatedAt ?? recent,
    ...(opts.validation ? { validation: opts.validation } : {}),
  };
}

function item(values: Item["values"]): Item {
  return {
    id: "x",
    displayName: "X",
    aliases: [],
    category: "gun",
    rarity: "godly",
    chroma: false,
    values,
  };
}

describe("roundValue", () => {
  it("rounds half away from zero", () => {
    expect(roundValue(2.5)).toBe(3);
    expect(roundValue(2.4)).toBe(2);
    expect(roundValue(-2.5)).toBe(-3);
    expect(roundValue(-2.4)).toBe(-2);
  });

  it("returns 0 for non-finite input", () => {
    expect(roundValue(Infinity)).toBe(0);
    expect(roundValue(-Infinity)).toBe(0);
    expect(roundValue(NaN)).toBe(0);
  });
});

describe("sourceModeLabel", () => {
  it("presents consensus as the Combined estimate", () => {
    expect(sourceModeLabel("consensus")).toBe("Combined estimate");
    expect(sourceModeLabel("supreme")).toBe("Supreme Values");
    expect(sourceModeLabel("mm2values")).toBe("MM2Values");
  });
});

describe("resolveValue", () => {
  it("combines multiple sources as an unweighted mean", () => {
    const r = resolveValue(item({ supreme: reading(100), mm2values: reading(120) }), "consensus", now);
    expect(r?.value).toBeCloseTo(110, 5);
    expect(r?.readings).toHaveLength(2);
  });

  it("works when only one source has a value", () => {
    const r = resolveValue(item({ supreme: reading(1000) }), "consensus", now);
    expect(r?.value).toBe(1000);
    expect(r?.readings).toHaveLength(1);
    expect(r?.disagreement).toBe(0);
    // A lone reading is never "high" confidence.
    expect(r?.confidence).not.toBe("high");
  });

  it("returns undefined for a single source that has no reading", () => {
    const r = resolveValue(item({ supreme: reading(1000) }), "mm2values", now);
    expect(r).toBeUndefined();
  });

  it("returns undefined when the item has no values at all", () => {
    const r = resolveValue(item({} as Item["values"]), "consensus", now);
    expect(r).toBeUndefined();
  });

  it("surfaces strong disagreement instead of hiding it", () => {
    const r = resolveValue(item({ supreme: reading(1000), mm2values: reading(2000) }), "consensus", now);
    expect(r?.value).toBeCloseTo(1500, 5);
    expect(r?.disagreement).toBeGreaterThan(0.5);
    expect(r?.confidence).toBe("low");
    // The underlying readings remain available for display.
    expect(r?.readings.map((x) => x.value).sort((a, b) => a - b)).toEqual([1000, 2000]);
  });

  it("uses only the selected source's metadata for source-specific resolution", () => {
    const r = resolveValue(
      item({
        supreme: reading(100, { demand: 5, updatedAt: recent, stability: "stable" }),
        mm2values: reading(1000, { demand: 1, updatedAt: old, stability: "volatile" }),
      }),
      "supreme",
      now,
    );
    expect(r?.value).toBe(100);
    expect(r?.demand).toBe(5);
    expect(r?.stale).toBe(false);
    expect(r?.stability).toBe("stable");
    expect(r?.disagreement).toBe(0);
    expect(r?.confidence).toBe("high");
    expect(r?.readings).toHaveLength(2);
  });

  it("marks values as stale and drops confidence when data is old", () => {
    const r = resolveValue(
      item({ supreme: reading(1000, { updatedAt: old }), mm2values: reading(1000, { updatedAt: old }) }),
      "consensus",
      now,
    );
    expect(r?.stale).toBe(true);
    expect(r?.confidence).toBe("low");
  });

  it("handles zero-valued readings without treating them as missing", () => {
    const r = resolveValue(item({ supreme: reading(0), mm2values: reading(0) }), "consensus", now);
    expect(r?.value).toBe(0);
    expect(r?.disagreement).toBe(0);
    expect(r?.readings).toHaveLength(2);
  });
});
