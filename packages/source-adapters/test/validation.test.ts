import { describe, it, expect } from "vitest";
import { parseSnapshot } from "@tradelens/item-schema";
import { mergeSources, slugify, buildSnapshot, type RawRow } from "../src/index.js";
import { sampleSnapshot } from "../src/sample.js";

const updatedAt = "2026-07-29T15:10:00Z";

describe("slugify", () => {
  it("produces lowercase hyphenated ids", () => {
    expect(slugify("Chroma Luger")).toBe("chroma-luger");
    expect(slugify("Icepiercer")).toBe("icepiercer");
  });
});

describe("mergeSources", () => {
  it("combines readings from multiple sources under one item", () => {
    const supreme: RawRow[] = [
      { name: "Bat", category: "knife", rarity: "godly", value: 425, updatedAt },
    ];
    const mm2values: RawRow[] = [
      { name: "Bat", category: "knife", rarity: "godly", value: 400, updatedAt },
    ];
    const items = mergeSources({ supreme, mm2values });
    expect(items).toHaveLength(1);
    expect(items[0]!.values.supreme?.value).toBe(425);
    expect(items[0]!.values.mm2values?.value).toBe(400);
  });

  it("skips and reports rows that cannot be mapped", () => {
    const failures: string[] = [];
    const supreme: RawRow[] = [
      { name: "", category: "knife", rarity: "godly", value: 1, updatedAt },
      { name: "Bat", category: "knife", rarity: "godly", value: 425, updatedAt },
    ];
    const items = mergeSources({ supreme }, undefined, undefined, (f) => failures.push(f.reason));
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("bat");
    expect(failures).toHaveLength(1);
  });

  it("merges aliases across sources", () => {
    const items = mergeSources({
      supreme: [
        {
          name: "Icepiercer",
          aliases: ["ip"],
          category: "gun",
          rarity: "ancient",
          value: 1,
          updatedAt,
        },
      ],
      mm2values: [
        {
          name: "Icepiercer",
          aliases: ["ice piercer"],
          category: "gun",
          rarity: "ancient",
          value: 1,
          updatedAt,
        },
      ],
    });
    expect(items[0]!.aliases).toEqual(expect.arrayContaining(["ip", "ice piercer"]));
  });
});

describe("sample snapshot", () => {
  it("validates against the item schema", () => {
    expect(() => parseSnapshot(sampleSnapshot)).not.toThrow();
  });

  it("has both sources on every item", () => {
    for (const item of sampleSnapshot.items) {
      expect(item.values.supreme).toBeDefined();
      expect(item.values.mm2values).toBeDefined();
    }
  });
});

describe("buildSnapshot", () => {
  it("increments revision and validates", () => {
    const snap = buildSnapshot([], ["supreme"], 7);
    expect(snap.revision).toBe(7);
    expect(() => parseSnapshot(snap)).not.toThrow();
  });
});
