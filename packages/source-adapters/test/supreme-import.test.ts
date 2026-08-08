import { describe, expect, it } from "vitest";
import type { ValueSnapshot } from "@tradelens/item-schema";
import {
  mergeSupremeCapture,
  parseSupremeCapture,
  parseSupremeHtml,
  parseSupremeText,
  parseValueToken,
} from "../src/supreme-import.js";

const NOW = "2026-08-07T00:00:00.000Z";

function baseSnapshot(): ValueSnapshot {
  return {
    schemaVersion: 1,
    revision: 3,
    generatedAt: "2026-08-01T00:00:00.000Z",
    sources: ["mm2values"],
    items: [
      {
        id: "chroma-luger",
        displayName: "Chroma Luger",
        aliases: [],
        category: "gun",
        rarity: "chroma",
        chroma: true,
        verified: true,
        values: {
          mm2values: { value: 100, updatedAt: NOW },
        },
      },
      {
        id: "harvester",
        displayName: "Harvester",
        aliases: [],
        category: "knife",
        rarity: "godly",
        chroma: false,
        verified: true,
        values: {
          supreme: { value: 320, updatedAt: "2026-07-01T00:00:00.000Z" },
        },
      },
    ],
  };
}

describe("parseValueToken", () => {
  it("handles K/M/B suffixes and grouped numbers", () => {
    expect(parseValueToken("124K")).toBe(124_000);
    expect(parseValueToken("1.2M")).toBe(1_200_000);
    expect(parseValueToken("36,250")).toBe(36_250);
    expect(parseValueToken("2B")).toBe(2_000_000_000);
    expect(parseValueToken("nope")).toBeUndefined();
  });
});

describe("parseSupremeHtml", () => {
  it("parses head/body item blocks", () => {
    const html = `
      <div class="itemhead">Chroma Luger</div>
      <div class="itembody">
        Value - <b class="itemvalue val-top">75,000</b>
        <b class="itemstability stable">Stable</b>
        Demand - <b>8</b> Rarity - <b>4</b>
      </div>`;
    const rows = parseSupremeHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Chroma Luger", value: 75_000, demand: 8, rarity: 4 });
  });
});

describe("parseSupremeText", () => {
  it("parses copied page text blocks", () => {
    const text = ["Harvester", "Value - 350 [340 - 360]", "Stability - Stable", "Demand - 8"].join(
      "\n",
    );
    const rows = parseSupremeText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Harvester", value: 350 });
  });
});

describe("parseSupremeCapture", () => {
  it("detects JSON payloads", () => {
    const rows = parseSupremeCapture('{"items":[{"name":"Harvester","value":350}]}');
    expect(rows).toEqual([{ name: "Harvester", value: 350, demand: undefined, rarity: undefined, stability: undefined }]);
  });
});

describe("mergeSupremeCapture", () => {
  it("updates an existing supreme reading, tracks previous value, and bumps revision", () => {
    const snap = baseSnapshot();
    const { snapshot, report } = mergeSupremeCapture(
      snap,
      '{"items":[{"name":"Harvester","value":350}]}',
      NOW,
    );
    expect(report.changed).toBe(1);
    expect(report.added).toBe(0);
    expect(report.unmatched).toBe(0);
    expect(snapshot.revision).toBe(4);
    expect(snapshot.generatedAt).toBe(NOW);
    const harvester = snapshot.items.find((i) => i.id === "harvester")!;
    expect(harvester.values.supreme?.value).toBe(350);
    expect(harvester.values.supreme?.previousValue).toBe(320);
    // Original snapshot is untouched.
    expect(snap.items.find((i) => i.id === "harvester")!.values.supreme?.value).toBe(320);
  });

  it("adds a supreme reading to an item that had none", () => {
    const snap = baseSnapshot();
    const { snapshot, report } = mergeSupremeCapture(
      snap,
      '{"items":[{"name":"Chroma Luger","value":90000}]}',
      NOW,
    );
    expect(report.added).toBe(1);
    expect(snapshot.sources).toContain("supreme");
    const luger = snapshot.items.find((i) => i.id === "chroma-luger")!;
    expect(luger.values.supreme?.value).toBe(90_000);
  });

  it("counts rows with no matching item as unmatched and never invents items", () => {
    const snap = baseSnapshot();
    const { snapshot, report } = mergeSupremeCapture(
      snap,
      '{"items":[{"name":"Totally Unknown Knife","value":5}]}',
      NOW,
    );
    expect(report.unmatched).toBe(1);
    expect(report.changed + report.added).toBe(0);
    expect(snapshot.items).toHaveLength(2);
    // No changes → revision preserved.
    expect(snapshot.revision).toBe(3);
  });

  it("keeps the revision when the capture matches current values", () => {
    const snap = baseSnapshot();
    const { snapshot, report } = mergeSupremeCapture(
      snap,
      '{"items":[{"name":"Harvester","value":320}]}',
      NOW,
    );
    expect(report.changed + report.added).toBe(0);
    expect(snapshot.revision).toBe(3);
  });
});
