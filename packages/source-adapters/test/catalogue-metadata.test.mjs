import { describe, expect, it } from "vitest";
import {
  deriveCatalogueMetadata,
  disambiguateCatalogueRows,
  inferCategory,
  inferYear,
} from "../scripts/catalogue-metadata.mjs";

describe("catalogue metadata", () => {
  it("prefers explicit wiki item type and year", () => {
    const result = deriveCatalogueMetadata({
      name: "Bats",
      sourceCategory: "common",
      imageUrl: "https://www.mm2values.com/img/Bats_knife24.png",
      wikiUrl: "https://murder-mystery-2.fandom.com/wiki/Bats_Gun_(2024)",
    });
    expect(result).toEqual({ displayName: "Bats", category: "gun", year: 2024 });
  });

  it("uses licensed image metadata when no wiki metadata exists", () => {
    expect(
      inferCategory({
        sourceCategory: "godly",
        displayName: "Blossom",
        imageUrl: "https://www.mm2values.com/img/BlossomGun.png",
      }),
    ).toBe("gun");
    expect(inferYear({ imageUrl: "https://www.mm2values.com/img/StickersG25.png" })).toBe(2025);
  });

  it("disambiguates collisions with type, year, rarity, and source id fallbacks", () => {
    const rows = [
      { displayName: "Bats", category: "knife", year: 2020, rarity: "common", sourceItemId: "613" },
      { displayName: "Bats", category: "gun", year: 2024, rarity: "common", sourceItemId: "835" },
      { displayName: "Bats", category: "knife", year: 2024, rarity: "common", sourceItemId: "847" },
      { displayName: "Bats", category: "knife", year: 2024, rarity: "common", sourceItemId: "999" },
    ];
    disambiguateCatalogueRows(rows);
    expect(rows.map((row) => row.catalogueName)).toEqual([
      "Bats (Knife, 2020)",
      "Bats (Gun, 2024)",
      "Bats (Knife, 2024, Common, MM2Values #847)",
      "Bats (Knife, 2024, Common, MM2Values #999)",
    ]);
  });

  it("never emits an empty disambiguation label", () => {
    const rows = [
      { displayName: "Blossom", category: "other", rarity: "common", sourceItemId: "209" },
      { displayName: "Blossom", category: "gun", rarity: "godly", sourceItemId: "696" },
    ];
    disambiguateCatalogueRows(rows);
    expect(rows.map((row) => row.catalogueName)).toEqual(["Blossom (Common)", "Blossom (Gun)"]);
  });
});
