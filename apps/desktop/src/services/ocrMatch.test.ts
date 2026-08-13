import { describe, expect, it } from "vitest";
import { SearchIndex } from "@tradelens/trade-engine";
import type { Item } from "@/types";
import {
  analyzeOcr,
  filterWords,
  groupRegions,
  isUiNoise,
  MIN_WORD_CONFIDENCE,
  type OcrWord,
} from "./ocrMatch";

function item(id: string, displayName: string, aliases: string[] = []): Item {
  return { id, displayName, aliases } as unknown as Item;
}

const index = new SearchIndex([
  item("icepiercer", "Ice Piercer", ["ip"]),
  item("chroma-seer", "Chroma Seer"),
  item("seer", "Seer"),
  item("elderwand", "Elderwand"),
]);

function word(text: string, confidence = 90, bbox?: OcrWord["bbox"]): OcrWord {
  return { text, confidence, bbox };
}

describe("isUiNoise", () => {
  it("treats interface words, single chars and numbers as noise", () => {
    expect(isUiNoise("Trade")).toBe(true);
    expect(isUiNoise("accept")).toBe(true);
    expect(isUiNoise("Robux")).toBe(true);
    expect(isUiNoise("123")).toBe(true);
    expect(isUiNoise("x")).toBe(true);
  });

  it("keeps plausible item words", () => {
    expect(isUiNoise("Piercer")).toBe(false);
    expect(isUiNoise("Elderwand")).toBe(false);
  });
});

describe("filterWords", () => {
  it("drops low-confidence and interface words", () => {
    const kept = filterWords([
      word("Ice", 90),
      word("Piercer", 40), // low confidence
      word("Trade", 99), // ui noise
      word("Seer", 80),
    ]);
    expect(kept.map((w) => w.text)).toEqual(["Ice", "Seer"]);
  });

  it("respects the default confidence floor", () => {
    const kept = filterWords([word("Seer", MIN_WORD_CONFIDENCE - 1)]);
    expect(kept).toHaveLength(0);
  });
});

describe("groupRegions", () => {
  it("splits words into horizontal bands using bounding boxes", () => {
    const regions = groupRegions([
      word("Ice", 90, { x0: 0, y0: 0, x1: 20, y1: 12 }),
      word("Piercer", 90, { x0: 22, y0: 1, x1: 60, y1: 13 }),
      word("Elderwand", 90, { x0: 0, y0: 40, x1: 60, y1: 52 }),
    ]);
    expect(regions).toHaveLength(2);
    expect(regions[0]!.map((w) => w.text)).toEqual(["Ice", "Piercer"]);
    expect(regions[1]!.map((w) => w.text)).toEqual(["Elderwand"]);
  });

  it("falls back to a single region without geometry", () => {
    const regions = groupRegions([word("Ice"), word("Piercer")]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveLength(2);
  });
});

describe("analyzeOcr", () => {
  it("matches multi-word item names from a region", () => {
    const candidates = analyzeOcr(index, [
      word("Ice", 95, { x0: 0, y0: 0, x1: 20, y1: 12 }),
      word("Piercer", 95, { x0: 22, y0: 0, x1: 60, y1: 12 }),
    ]);
    expect(candidates.map((c) => c.item.id)).toContain("icepiercer");
  });

  it("never yields the same item twice from overlapping phrases", () => {
    const candidates = analyzeOcr(index, [
      word("Ice", 95, { x0: 0, y0: 0, x1: 20, y1: 12 }),
      word("Piercer", 95, { x0: 22, y0: 0, x1: 60, y1: 12 }),
    ]);
    const ids = candidates.map((c) => c.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores low-confidence and interface words when matching", () => {
    const candidates = analyzeOcr(index, [
      word("Trade", 99),
      word("Accept", 99),
      word("Seer", 30), // below confidence floor
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("flags weak matches as uncertain", () => {
    const candidates = analyzeOcr(index, [
      word("Seer", 60, { x0: 0, y0: 0, x1: 30, y1: 12 }),
    ]);
    const seer = candidates.find((c) => c.item.id === "seer");
    expect(seer?.uncertain).toBe(true);
  });

  it("offers alternative items for an ambiguous label", () => {
    const candidates = analyzeOcr(
      index,
      [word("Seer", 95, { x0: 0, y0: 0, x1: 30, y1: 12 })],
      { minScore: 0.4 },
    );
    const top = candidates[0]!;
    expect(top.item.id).toBe("seer");
    expect(top.alternatives.some((a) => a.item.id === "chroma-seer")).toBe(true);
  });

  it("respects the maxResults cap", () => {
    const candidates = analyzeOcr(
      index,
      [
        word("Seer", 95, { x0: 0, y0: 0, x1: 30, y1: 12 }),
        word("Elderwand", 95, { x0: 0, y0: 40, x1: 60, y1: 52 }),
      ],
      { maxResults: 1 },
    );
    expect(candidates).toHaveLength(1);
  });
});
