import { describe, it, expect } from "vitest";
import type { Item, SourceValue } from "@tradelens/item-schema";
import { detectValueChanges } from "../src/changes.js";

const now = Date.parse("2026-07-30T12:00:00Z");
const recent = "2026-07-30T10:00:00Z";

function reading(value: number): SourceValue {
  return { value, demand: 3, stability: "stable", updatedAt: recent };
}

function item(
  id: string,
  supreme: number,
  mm2values: number,
  rarity: Item["rarity"] = "godly",
  chroma = false,
): Item {
  return {
    id,
    displayName: id,
    aliases: [],
    category: "gun",
    rarity,
    chroma,
    values: { supreme: reading(supreme), mm2values: reading(mm2values) },
  };
}

describe("detectValueChanges", () => {
  it("reports any item that moved by the threshold, across all rarities", () => {
    const prev = [
      item("pet", 100, 100, "pet"),
      item("chroma-gun", 200, 200, "godly", true),
      item("unique", 300, 300, "unique"),
    ];
    const next = [
      item("pet", 106, 106, "pet"), // +6 → alert
      item("chroma-gun", 202, 202, "godly", true), // +2 → no alert
      item("unique", 290, 290, "unique"), // -10 → alert
    ];
    const changes = detectValueChanges(prev, next, "consensus", 5, now);
    const ids = changes.map((c) => c.item.id);
    expect(ids).toContain("pet");
    expect(ids).toContain("unique");
    expect(ids).not.toContain("chroma-gun");
  });

  it("includes a move of exactly the threshold (5+)", () => {
    const prev = [item("a", 100, 100)];
    const next = [item("a", 105, 105)];
    const changes = detectValueChanges(prev, next, "consensus", 5, now);
    expect(changes).toHaveLength(1);
    expect(changes[0].change).toBe(5);
    expect(changes[0].from).toBe(100);
    expect(changes[0].to).toBe(105);
  });

  it("reports signed change and percentage", () => {
    const prev = [item("a", 100, 100)];
    const next = [item("a", 80, 80)];
    const [c] = detectValueChanges(prev, next, "consensus", 5, now);
    expect(c.change).toBe(-20);
    expect(c.changePercent).toBeCloseTo(-20, 5);
  });

  it("sorts by the size of the move, largest first", () => {
    const prev = [item("a", 100, 100), item("b", 100, 100)];
    const next = [item("a", 110, 110), item("b", 150, 150)];
    const changes = detectValueChanges(prev, next, "consensus", 5, now);
    expect(changes.map((c) => c.item.id)).toEqual(["b", "a"]);
  });

  it("ignores items added or removed between snapshots", () => {
    const prev = [item("a", 100, 100)];
    const next = [item("a", 100, 100), item("new", 500, 500)];
    const changes = detectValueChanges(prev, next, "consensus", 5, now);
    expect(changes).toHaveLength(0);
  });

  it("respects the source mode when resolving values", () => {
    // Supreme unchanged, MM2Values jumps: consensus moves, supreme-only doesn't.
    const prev = [item("a", 100, 100)];
    const next = [item("a", 100, 200)];
    expect(detectValueChanges(prev, next, "supreme", 5, now)).toHaveLength(0);
    expect(detectValueChanges(prev, next, "consensus", 5, now)).toHaveLength(1);
  });
});
