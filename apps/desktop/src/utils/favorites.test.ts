import { describe, it, expect } from "vitest";
import type { Favorite, Item } from "@/types";
import {
  resolveFavorites,
  canonicalFavoriteId,
  dedupeFavorites,
  exportFavorites,
  parseFavoritesImport,
  mergeFavorites,
} from "./favorites";

function item(id: string, displayName: string, aliases: string[] = []): Item {
  return {
    id,
    displayName,
    aliases,
    category: "knife",
    rarity: "godly",
    chroma: false,
    verified: true,
    values: {},
  } as unknown as Item;
}

function fav(itemId: string, baselineValue = 10): Favorite {
  return { itemId, baselineValue, createdAt: "2026-07-31T00:00:00.000Z" };
}

describe("resolveFavorites", () => {
  it("keeps a favorite active across a rename (id stable, name changes)", () => {
    const favorites = [fav("seer")];
    const items = [item("seer", "Seer (2026 Edition)")];
    const [resolved] = resolveFavorites(favorites, items);
    expect(resolved!.status).toBe("active");
    expect(resolved!.item?.displayName).toBe("Seer (2026 Edition)");
  });

  it("remaps a favorite when its old id survives as an alias", () => {
    const favorites = [fav("old-seer")];
    const items = [item("seer", "Seer", ["old-seer"])];
    const [resolved] = resolveFavorites(favorites, items);
    expect(resolved!.status).toBe("remapped");
    expect(resolved!.remappedTo).toBe("seer");
    expect(canonicalFavoriteId(resolved!)).toBe("seer");
  });

  it("marks a favorite retired when the item is gone", () => {
    const [resolved] = resolveFavorites([fav("ghost")], [item("seer", "Seer")]);
    expect(resolved!.status).toBe("retired");
    expect(resolved!.item).toBeUndefined();
    expect(canonicalFavoriteId(resolved!)).toBe("ghost");
  });

  it("preserves order", () => {
    const favorites = [fav("a"), fav("b"), fav("c")];
    const items = [item("a", "A"), item("c", "C")];
    const statuses = resolveFavorites(favorites, items).map((r) => r.favorite.itemId);
    expect(statuses).toEqual(["a", "b", "c"]);
  });
});

describe("dedupeFavorites", () => {
  it("keeps the first occurrence of each id", () => {
    const deduped = dedupeFavorites([fav("seer", 10), fav("seer", 20), fav("chroma", 5)]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.baselineValue).toBe(10);
  });
});

describe("export/import round-trip", () => {
  it("round-trips through export and import", () => {
    const favorites = [fav("seer"), fav("chroma")];
    const json = exportFavorites(favorites, new Date("2026-07-31T00:00:00.000Z"));
    expect(parseFavoritesImport(json)).toEqual(favorites);
  });

  it("dedupes on export", () => {
    const json = exportFavorites([fav("seer", 1), fav("seer", 2)]);
    expect(parseFavoritesImport(json)).toHaveLength(1);
  });

  it("accepts a bare array of favorites", () => {
    const json = JSON.stringify([fav("seer")]);
    expect(parseFavoritesImport(json).map((f) => f.itemId)).toEqual(["seer"]);
  });

  it("skips invalid records but keeps valid ones", () => {
    const json = JSON.stringify([
      fav("seer"),
      { itemId: "", baselineValue: 1, createdAt: "x" },
      { itemId: "bad", baselineValue: "NaN", createdAt: "x" },
      { nonsense: true },
    ]);
    expect(parseFavoritesImport(json).map((f) => f.itemId)).toEqual(["seer"]);
  });

  it("throws on non-JSON and unrecognised payloads", () => {
    expect(() => parseFavoritesImport("not json")).toThrow(/valid JSON/);
    expect(() => parseFavoritesImport(JSON.stringify({ kind: "other" }))).toThrow(
      /favorites export/,
    );
  });
});

describe("mergeFavorites", () => {
  it("adds only new favorites and reports the count", () => {
    const existing = [fav("seer")];
    const incoming = [fav("seer", 99), fav("chroma"), fav("chroma")];
    const { merged, added } = mergeFavorites(existing, incoming);
    expect(added).toBe(1);
    expect(merged.map((f) => f.itemId)).toEqual(["seer", "chroma"]);
    // Existing baseline is preserved, not overwritten.
    expect(merged[0]!.baselineValue).toBe(10);
  });
});
