import { describe, it, expect } from "vitest";
import type { Item, SourceId, SourceValue } from "@tradelens/item-schema";
import {
  auditItems,
  formatAuditReport,
  auditFindings,
  auditReportToCsv,
  auditReportToJson,
} from "../src/audit.js";

const NOW = "2026-01-01T00:00:00.000Z";

function reading(value: number): SourceValue {
  return { value, updatedAt: NOW };
}

function item(overrides: Partial<Item> & Pick<Item, "id" | "displayName">): Item {
  return {
    aliases: [],
    category: "knife",
    rarity: "godly",
    chroma: false,
    verified: true,
    values: {} as Record<SourceId, SourceValue>,
    ...overrides,
  };
}

describe("auditItems", () => {
  it("reports a clean bill for well-formed items", () => {
    const items: Item[] = [
      item({
        id: "icepiercer",
        displayName: "Icepiercer",
        values: { supreme: reading(100), mm2values: reading(105) },
      }),
      item({
        id: "seer",
        displayName: "Seer",
        values: { supreme: reading(40), mm2values: reading(41) },
      }),
    ];
    const report = auditItems(items);
    expect(report.clean).toBe(true);
    expect(report.itemCount).toBe(2);
  });

  it("flags non-canonical ids", () => {
    const items: Item[] = [
      item({
        id: "ice-piercer",
        displayName: "Icepiercer",
        values: { supreme: reading(100), mm2values: reading(100) },
      }),
    ];
    const report = auditItems(items);
    expect(report.nonCanonicalIds).toContain("ice-piercer");
    expect(report.clean).toBe(false);
  });

  it("detects duplicate ids", () => {
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer", values: { supreme: reading(40) } }),
      item({ id: "seer", displayName: "Seer", values: { mm2values: reading(41) } }),
    ];
    const report = auditItems(items);
    expect(report.duplicateIds.some((g) => g.key === "seer")).toBe(true);
  });

  it("detects duplicate names across distinct items", () => {
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer", values: { supreme: reading(40) } }),
      item({ id: "seer-alt", displayName: "Seer", values: { mm2values: reading(41) } }),
    ];
    const report = auditItems(items);
    expect(report.duplicateNames.some((g) => g.key === "seer")).toBe(true);
  });

  it("flags an alias that collides with another item's name", () => {
    const items: Item[] = [
      item({
        id: "icepiercer",
        displayName: "Icepiercer",
        aliases: ["seer"],
        values: { supreme: reading(100), mm2values: reading(100) },
      }),
      item({
        id: "seer",
        displayName: "Seer",
        values: { supreme: reading(40), mm2values: reading(40) },
      }),
    ];
    const report = auditItems(items);
    expect(report.duplicateAliases.some((g) => g.key === "seer")).toBe(true);
  });

  it("reports missing required sources and single-source items", () => {
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer", values: { supreme: reading(40) } }),
    ];
    const report = auditItems(items, { requiredSources: ["supreme", "mm2values"] });
    expect(report.missingBySource.mm2values).toContain("seer");
    expect(report.sourceOnly).toEqual([{ itemId: "seer", source: "supreme" }]);
  });

  it("reports source disagreement beyond the threshold", () => {
    const items: Item[] = [
      item({
        id: "seer",
        displayName: "Seer",
        values: { supreme: reading(40), mm2values: reading(80) },
      }),
    ];
    const report = auditItems(items, { conflictThreshold: 0.15 });
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.itemId).toBe("seer");
  });

  it("flags unverified items", () => {
    const items: Item[] = [
      item({
        id: "seer",
        displayName: "Seer",
        verified: false,
        values: { supreme: reading(40), mm2values: reading(40) },
      }),
    ];
    const report = auditItems(items);
    expect(report.unverified).toContain("seer");
    expect(report.clean).toBe(false);
  });

  it("renders a readable summary", () => {
    const report = auditItems([
      item({ id: "seer", displayName: "Seer", values: { supreme: reading(40) } }),
    ]);
    expect(formatAuditReport(report)).toContain("Audited 1 items");
  });
});

describe("auditItems — additional checks", () => {
  it("detects conflicting categories, rarities and types among same-named items", () => {
    const items: Item[] = [
      item({
        id: "seer",
        displayName: "Seer",
        category: "gun",
        rarity: "godly",
        chroma: false,
        values: { supreme: reading(40) },
      }),
      item({
        id: "seer-alt",
        displayName: "Seer",
        category: "knife",
        rarity: "ancient",
        chroma: true,
        values: { mm2values: reading(41) },
      }),
    ];
    const report = auditItems(items);
    expect(report.conflictingCategories.some((c) => c.name === "seer")).toBe(true);
    expect(report.conflictingRarities.some((c) => c.name === "seer")).toBe(true);
    expect(report.conflictingTypes.some((c) => c.name === "seer")).toBe(true);
  });

  it("detects impossible or negative values", () => {
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer", values: { supreme: { value: -5, updatedAt: NOW } } }),
    ];
    const report = auditItems(items);
    expect(report.impossibleValues).toHaveLength(1);
    expect(report.impossibleValues[0]!.itemId).toBe("seer");
    expect(report.clean).toBe(false);
  });

  it("detects extreme value changes", () => {
    const items: Item[] = [
      item({
        id: "seer",
        displayName: "Seer",
        values: { supreme: { value: 500, previousValue: 40, updatedAt: NOW } },
      }),
    ];
    const report = auditItems(items, { extremeChangeFactor: 5 });
    expect(report.extremeChanges).toHaveLength(1);
    expect(report.extremeChanges[0]!.from).toBe(40);
    expect(report.extremeChanges[0]!.to).toBe(500);
  });

  it("detects future and missing timestamps", () => {
    const future = "2999-01-01T00:00:00.000Z";
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer", values: { supreme: { value: 40, updatedAt: future } } }),
    ];
    const report = auditItems(items, { now: new Date("2026-01-01T00:00:00.000Z") });
    expect(report.futureTimestamps.some((t) => t.itemId === "seer")).toBe(true);
  });

  it("surfaces unmapped source records passed in options", () => {
    const report = auditItems([], {
      unmappedRecords: [{ source: "supreme", name: "???", reason: "empty slug" }],
    });
    expect(report.unmappedRecords).toHaveLength(1);
    expect(report.clean).toBe(false);
  });

  it("detects missing and broken image paths", () => {
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer", image: "", values: { supreme: reading(40) } }),
      item({
        id: "gemseer",
        displayName: "Gemseer",
        image: "not a real path",
        values: { supreme: reading(40) },
      }),
    ];
    const report = auditItems(items);
    expect(report.missingImages).toContain("seer");
    expect(report.brokenImagePaths).toContain("gemseer");
  });

  it("detects duplicate images by hash", () => {
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer", image: "a.png", values: { supreme: reading(40) } }),
      item({ id: "gemseer", displayName: "Gemseer", image: "b.png", values: { supreme: reading(40) } }),
    ];
    const report = auditItems(items, { imageHashes: { "a.png": "H1", "b.png": "H1" } });
    expect(report.duplicateImages.some((g) => g.key === "H1")).toBe(true);
  });

  it("exports findings as CSV and JSON", () => {
    const report = auditItems([
      item({ id: "bad-id", displayName: "Seer", values: { supreme: reading(40) } }),
    ]);
    const findings = auditFindings(report);
    expect(findings.length).toBeGreaterThan(0);
    const csv = auditReportToCsv(report);
    expect(csv.split("\n")[0]).toBe("category,key,detail");
    expect(csv).toContain("non-canonical-id");
    const json = JSON.parse(auditReportToJson(report));
    expect(json.itemCount).toBe(1);
  });
});
