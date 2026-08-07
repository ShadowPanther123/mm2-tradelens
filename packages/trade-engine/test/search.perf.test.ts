import { describe, it, expect } from "vitest";
import type { Item } from "@tradelens/item-schema";
import { SearchIndex } from "../src/search.js";

const updatedAt = "2026-07-30T10:00:00Z";

/** Build a large, realistic-ish catalogue for benchmarking. */
function makeCatalogue(count: number): Item[] {
  const bases = ["Ice", "Fire", "Shadow", "Elder", "Frost", "Storm", "Void", "Gold"];
  const suffixes = ["piercer", "breaker", "blaster", "wood", "scythe", "blade", "fang"];
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const base = bases[i % bases.length];
    const suffix = suffixes[(i >> 3) % suffixes.length];
    items.push({
      id: `item-${i}`,
      displayName: `${base} ${suffix} ${i}`,
      aliases: [`${base[0]}${suffix[0]}`.toLowerCase()],
      category: "gun",
      rarity: "ancient",
      chroma: i % 5 === 0,
      origin: `Season ${i % 12}`,
      verified: true,
      values: { supreme: { value: (i % 500) + 1, updatedAt } },
    });
  }
  return items;
}

describe("search benchmark (full catalogue)", () => {
  const catalogue = makeCatalogue(5000);

  it("builds the index once for the complete catalogue quickly", () => {
    const start = performance.now();
    const index = new SearchIndex(catalogue);
    const elapsed = performance.now() - start;
    expect(index.size).toBe(5000);
    // Generous bound — guards against accidental O(n^2) construction.
    expect(elapsed).toBeLessThan(1000);
  });

  it("runs many queries over the full catalogue within budget", () => {
    const index = new SearchIndex(catalogue);
    const queries = ["ice", "firebl", "shadowscythe", "elderwood", "frostfang", "xyzzy"];
    const start = performance.now();
    let total = 0;
    for (let i = 0; i < 200; i++) {
      total += index.search(queries[i % queries.length]).length;
    }
    const elapsed = performance.now() - start;
    expect(total).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(4000);
  });
});
