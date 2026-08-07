import { describe, it, expect } from "vitest";
import type { Item } from "@tradelens/item-schema";
import { searchItems, levenshtein, SearchIndex } from "../src/search.js";

const updatedAt = "2026-07-30T10:00:00Z";

interface MakeOptions {
  aliases?: string[];
  chroma?: boolean;
  category?: Item["category"];
  rarity?: Item["rarity"];
  origin?: string;
  verified?: boolean;
  values?: Item["values"];
}

function make(id: string, displayName: string, opts: MakeOptions = {}): Item {
  return {
    id,
    displayName,
    aliases: opts.aliases ?? [],
    category: opts.category ?? "gun",
    rarity: opts.rarity ?? "ancient",
    chroma: opts.chroma ?? false,
    origin: opts.origin,
    verified: opts.verified ?? true,
    values: opts.values ?? { supreme: { value: 100, updatedAt } },
  };
}

const items: Item[] = [
  make("icepiercer", "Icepiercer", { aliases: ["ice piercer", "ip"] }),
  make("icebreaker", "Icebreaker"),
  make("iceblaster", "Iceblaster"),
  make("harvester", "Harvester", { aliases: ["harv"] }),
  make("chroma-luger", "Luger", { aliases: ["cluger"], chroma: true }),
];

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("ice", "ice")).toBe(0);
  });
  it("counts single edits", () => {
    expect(levenshtein("ice", "icy")).toBe(1);
  });
  it("short-circuits beyond the max distance", () => {
    expect(levenshtein("abc", "xyzxyz", 2)).toBe(3);
  });
});

describe("searchItems", () => {
  it("returns prefix matches ordered by score", () => {
    const results = searchItems(items, "icep");
    expect(results[0]?.item.id).toBe("icepiercer");
  });

  it("matches aliases", () => {
    const results = searchItems(items, "ip");
    expect(results.some((r) => r.item.id === "icepiercer")).toBe(true);
  });

  it("tolerates misspellings", () => {
    const results = searchItems(items, "harvestor");
    expect(results[0]?.item.id).toBe("harvester");
  });

  it("finds all ice-prefixed items", () => {
    const results = searchItems(items, "ice");
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain("icepiercer");
    expect(ids).toContain("icebreaker");
    expect(ids).toContain("iceblaster");
  });

  it("understands chroma prefix", () => {
    const results = searchItems(items, "chroma luger");
    expect(results.some((r) => r.item.id === "chroma-luger")).toBe(true);
  });

  it("reuses a prepared index", () => {
    const index = new SearchIndex(items);
    expect(index.search("harv")[0]?.item.id).toBe("harvester");
  });
});

describe("search quality", () => {
  it("matches multi-word acronyms", () => {
    const catalogue = [
      make("elderwood-scythe", "Elderwood Scythe"),
      make("elderwood-blade", "Elderwood Blade"),
    ];
    const results = searchItems(catalogue, "es");
    expect(results[0]?.item.id).toBe("elderwood-scythe");
  });

  it("matches set / origin names", () => {
    const catalogue = [
      make("candy", "Candy", { origin: "Christmas 2022" }),
      make("frost", "Frost", { origin: "Christmas 2022" }),
      make("summer", "Summer", { origin: "Summer 2023" }),
    ];
    const ids = searchItems(catalogue, "christmas").map((r) => r.item.id);
    expect(ids).toContain("candy");
    expect(ids).toContain("frost");
    expect(ids).not.toContain("summer");
  });

  it("ranks exact matches above fuzzy matches", () => {
    const catalogue = [
      make("bat", "Bat"),
      make("hat", "Hat"),
      make("cat", "Cat"),
    ];
    const results = searchItems(catalogue, "bat");
    expect(results[0]?.item.id).toBe("bat");
    expect(results[0]?.matchedOn).toBe("name");
  });

  it("does not surface unrelated fuzzy results for short queries", () => {
    const catalogue = [
      make("ace", "Ace"),
      make("icy", "Icy"),
      make("orb", "Orb"),
    ];
    // "ice" is < 4 chars, so fuzzy is suppressed and nothing unrelated matches.
    expect(searchItems(catalogue, "ice")).toHaveLength(0);
  });

  it("breaks ties deterministically by verification then value", () => {
    const catalogue = [
      make("dupe-a", "Seer", {
        verified: false,
        values: { supreme: { value: 500, updatedAt } },
      }),
      make("dupe-b", "Seer", {
        verified: true,
        values: { supreme: { value: 100, updatedAt } },
      }),
    ];
    const results = searchItems(catalogue, "seer");
    expect(results[0]?.item.id).toBe("dupe-b");
  });
});

describe("search filters", () => {
  const catalogue = [
    make("knife-a", "Alpha", { category: "knife", rarity: "godly" }),
    make("gun-b", "Bravo", { category: "gun", rarity: "rare" }),
    make("pet-c", "Charlie", {
      category: "pet",
      rarity: "pet",
      values: { community: { value: 20, updatedAt } },
    }),
  ];

  it("filters by category", () => {
    const results = searchItems(catalogue, "a", 10, { categories: "knife" });
    expect(results.every((r) => r.item.category === "knife")).toBe(true);
  });

  it("filters by rarity", () => {
    const results = searchItems(catalogue, "a", 10, { rarities: ["godly", "rare"] });
    expect(results.some((r) => r.item.rarity === "pet")).toBe(false);
  });

  it("filters by source availability", () => {
    const results = searchItems(catalogue, "c", 10, { sources: "community" });
    expect(results.map((r) => r.item.id)).toEqual(["pet-c"]);
  });
});
