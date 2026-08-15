import { describe, expect, it } from "vitest";
import { ItemCategory, ItemRarity } from "@tradelens/item-schema";
import { mm2valuesSnapshot, mm2valuesItems } from "../src/mm2values.js";
import { auditItems, formatAuditReport } from "../src/audit.js";

const RARITIES = new Set(ItemRarity.options);
const CATEGORIES = new Set(ItemCategory.options);

describe("mm2values bundled snapshot", () => {
  it("includes mm2values as a bundled source", () => {
    expect(mm2valuesSnapshot.sources).toContain("mm2values");
    expect(mm2valuesSnapshot.schemaVersion).toBe(1);
    expect(mm2valuesItems.length).toBeGreaterThan(900);
  });

  it("gives every item a valid rarity and a positive-or-zero value", () => {
    for (const item of mm2valuesItems) {
      expect(RARITIES.has(item.rarity)).toBe(true);
      const reading = item.values.mm2values;
      expect(reading).toBeDefined();
      expect(reading!.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses unique item ids", () => {
    const ids = mm2valuesItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every item a non-empty display name that is unique for the vast majority", () => {
    // The canonical unique key is the item id (asserted separately). The
    // mm2values source is rarity-based and lists some seasonal or gun/knife
    // variants under identical names (e.g. "Pumpkin"), distinguished only by
    // id, so display names are near-unique rather than perfectly unique.
    for (const item of mm2valuesItems) {
      expect(item.displayName.trim().length).toBeGreaterThan(0);
    }
    const names = mm2valuesItems.map((item) => item.displayName.toLowerCase());
    const unique = new Set(names).size;
    expect(unique).toBeGreaterThan(names.length * 0.9);
  });

  it("derives a valid schema category for every item, tagging pets", () => {
    // mm2values is rarity-based: categories are derived from the source page
    // (pets are tagged "pet"; everything else is "other"). It exposes no
    // reliable item-type or release-year field, so those stay unset.
    for (const item of mm2valuesItems) {
      expect(CATEGORIES.has(item.category)).toBe(true);
    }
    expect(mm2valuesItems.filter((item) => item.category === "pet").length).toBeGreaterThan(0);
    expect(mm2valuesItems.every((item) => item.rarity === "pet" ? item.category === "pet" : true)).toBe(true);
  });

  it("keeps ratings within the 0–5 schema range", () => {
    for (const item of mm2valuesItems) {
      const reading = item.values.mm2values!;
      if (reading.demand !== undefined) {
        expect(reading.demand).toBeGreaterThanOrEqual(0);
        expect(reading.demand).toBeLessThanOrEqual(5);
      }
      if (reading.rarityScore !== undefined) {
        expect(reading.rarityScore).toBeGreaterThanOrEqual(0);
        expect(reading.rarityScore).toBeLessThanOrEqual(5);
      }
    }
  });

  it('strips the "Value: N" suffix from chroma display names', () => {
    const chroma = mm2valuesItems.filter((i) => i.chroma);
    expect(chroma.length).toBeGreaterThan(0);
    for (const item of chroma) {
      expect(item.displayName).not.toMatch(/Value:/i);
    }
  });

  it("does not include source-page controls as catalogue items", () => {
    expect(
      mm2valuesItems.some((item) =>
        /^(add|choose|select)\s+(item|weapon)$/i.test(item.displayName),
      ),
    ).toBe(false);
  });

  it("passes the production catalogue audit", () => {
    const report = auditItems(mm2valuesItems, {
      requiredSources: mm2valuesSnapshot.sources,
    });
    expect(report.clean, formatAuditReport(report)).toBe(true);
  });

  it("wires bundled item icons to canonical local paths", () => {
    const withIcon = mm2valuesItems.filter((i) => i.image);
    // The licensed manifest covers the great majority of items.
    expect(withIcon.length).toBeGreaterThan(800);
    for (const item of withIcon) {
      // Never a hotlink; always the canonical bundled path for this item id.
      expect(item.image).toMatch(new RegExp(`^icons/items/${item.id}\\.(png|webp|jpe?g)$`));
      expect(item.image).not.toMatch(/^https?:/i);
    }
  });

  it("wires every legendary item to a bundled icon", () => {
    const legendary = mm2valuesItems.filter((item) => item.rarity === "legendary");
    expect(legendary.length).toBeGreaterThan(0);
    for (const item of legendary) {
      expect(item.image).toMatch(new RegExp(`^icons/items/${item.id}\\.(png|webp|jpe?g)$`));
    }
  });
});
