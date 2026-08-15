import { describe, expect, it } from "vitest";
// The sync tool is a runnable .mjs script; import its pure helpers directly.
// (The package typechecks only `src`, so importing the script here is fine.)
import {
  parseMm2Html,
  parseSupremePayload,
  reconcile,
  slugify,
  mapStability,
  cleanStabilityLabel,
  reconcileIconPaths,
  mapCategory,
  reconcileCategories,
} from "../scripts/sync-values.mjs";

const MM2_BLOCK = `
<div class=stackable>
  <img src='img/BatwingUpdated.png' style='float:left;' width=100 height=100>
  <b>Batwing</b><br> Value: 45<br>Range: N/A <br>Demand: 2 - Rarity: 2<br>Stability: Stable<hr>
  <input type=button value="SV" onclick="stackValue(i3.value,'45','3');">
</div>
<div class=stackable>
  <img src='img/Celestial.png' style='float:left;' width=100 height=100>
  <b>Celestial</b><br> Value: 2,175<br>Range: 2175-2225 <br>Demand: 6 - Rarity: 3.5<br>Stability: Doing Well<hr>
  <input type=button value="SV" onclick="stackValue(i860.value,'2175','860');">
</div>
`;

describe("parseMm2Html", () => {
  it("extracts name, value, demand, rarity, stability, id and image", () => {
    const rows = parseMm2Html(MM2_BLOCK, "ancient");
    expect(rows).toHaveLength(2);

    const batwing = rows[0];
    expect(batwing).toMatchObject({
      name: "Batwing",
      value: 45,
      demand: 2,
      rarity: 2,
      stability: "Stable",
      sourceItemId: "3",
      category: "ancient",
      imageUrl: "https://www.mm2values.com/img/BatwingUpdated.png",
    });
    // "Range: N/A" carries no digits, so no range is recorded.
    expect(batwing.valueRange).toBeUndefined();

    // Comma-grouped values are parsed as numbers.
    expect(rows[1]).toMatchObject({ name: "Celestial", value: 2175, sourceItemId: "860" });
  });

  it("parses a published value range and leaves N/A undefined", () => {
    const rows = parseMm2Html(MM2_BLOCK, "ancient");
    expect(rows[0].valueRange).toBeUndefined();
    expect(rows[1].valueRange).toEqual({ low: 2175, high: 2225 });
  });

  it("preserves free-form stability labels while bucketing the enum", () => {
    // mm2values uses labels beyond the three-way enum (e.g. "Overpaid For").
    // Valuation judgements read as steady; only real movement is "fluctuating".
    expect(cleanStabilityLabel("Overpaid For")).toBe("Overpaid For");
    expect(mapStability("Overpaid For")).toBe("stable");
    expect(mapStability("Underpaid For")).toBe("stable");
    expect(mapStability("Doing Well")).toBe("stable");
    expect(cleanStabilityLabel("Stable")).toBe("Stable");
    expect(mapStability("Stable")).toBe("stable");
    // Genuine price movement still maps to the moving enum.
    expect(mapStability("Fluctuating")).toBe("fluctuating");
    expect(mapStability("Receding")).toBe("fluctuating");
    // Blank / N/A carry no label.
    expect(cleanStabilityLabel("  ")).toBeUndefined();
    expect(cleanStabilityLabel("N/A")).toBeUndefined();
  });

  it("ignores markup that is not an item block", () => {
    expect(parseMm2Html("<div>no items here</div>", "misc")).toEqual([]);
  });

  it("extracts chroma names wrapped in an inner element", () => {
    // Chroma pages nest the name inside a <div> within the <b> tag.
    const html = `
<div class=stackable>
  <img src='img/Chroma_Evergreen.png' width=100 height=100>
  <b><div id='chromas' class='chroma-text'>Chroma Evergreen</div></b> Value: 48,000<br>Range: N/A <br>Demand: 6 - Rarity: 7<br>Stability: Stable<hr>
  <input type=button value="SV" onclick="stackValue(i773.value,'48000','773');">
</div>`;
    const rows = parseMm2Html(html, "chroma");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Chroma Evergreen",
      value: 48000,
      sourceItemId: "773",
      category: "chroma",
    });
  });
});

describe("parseSupremePayload", () => {
  it("accepts an { items: [...] } wrapper and a bare array", () => {
    const wrapped = parseSupremePayload({ items: [{ name: "Seer", value: 100, demand: 5 }] });
    expect(wrapped).toEqual([
      { name: "Seer", value: 100, demand: 5, rarity: undefined, stability: undefined },
    ]);

    const bare = parseSupremePayload([{ name: "Seer", value: 100 }]);
    expect(bare[0]).toMatchObject({ name: "Seer", value: 100 });
  });

  it("skips entries missing a name or numeric value", () => {
    const rows = parseSupremePayload([{ value: 1 }, { name: "X" }, { name: "Y", value: "nope" }]);
    expect(rows).toEqual([]);
  });
});

describe("reconcileIconPaths", () => {
  const index = new Map([
    ["batwing", "batwing.webp"],
    ["beach", "beach.png"],
  ]);

  it("pins each item image to the on-disk file for its id", () => {
    const snapshot = {
      items: [
        { id: "batwing", image: "icons/items/batwing.png" }, // stale extension
        { id: "beach" }, // missing image entirely
        { id: "unknown", image: "icons/items/unknown.png" }, // no file → untouched
      ],
    };
    const fixed = reconcileIconPaths(snapshot, index);
    expect(fixed).toBe(2);
    expect(snapshot.items[0].image).toBe("icons/items/batwing.webp");
    expect(snapshot.items[1].image).toBe("icons/items/beach.png");
    expect(snapshot.items[2].image).toBe("icons/items/unknown.png");
  });

  it("does nothing when every image already matches disk", () => {
    const snapshot = {
      items: [{ id: "batwing", image: "icons/items/batwing.webp" }],
    };
    expect(reconcileIconPaths(snapshot, index)).toBe(0);
  });

  it("is a no-op when the icon index is empty", () => {
    const snapshot = { items: [{ id: "batwing", image: "icons/items/batwing.png" }] };
    expect(reconcileIconPaths(snapshot, new Map())).toBe(0);
    expect(snapshot.items[0].image).toBe("icons/items/batwing.png");
  });
});

describe("mapCategory", () => {
  it("tags pets from the source category", () => {
    expect(mapCategory("pets", "Adopt Me Dog")).toBe("pet");
  });

  it("infers knives, guns and bundles from the item name", () => {
    expect(mapCategory("godly", "Nik's Scythe")).toBe("knife");
    expect(mapCategory("godly", "Chroma Laser Blade")).toBe("knife");
    expect(mapCategory("godly", "Ice Dagger")).toBe("knife");
    expect(mapCategory("godly", "Ray Gun")).toBe("gun");
    expect(mapCategory("godly", "Blaster")).toBe("gun");
    expect(mapCategory("misc", "Halloween Set")).toBe("bundle");
    expect(mapCategory("misc", "Starter Pack")).toBe("bundle");
  });

  it("falls back to other when nothing matches", () => {
    expect(mapCategory("godly", "Seer")).toBe("other");
    expect(mapCategory("rare", "Batwing")).toBe("other");
  });
});

describe("reconcileCategories", () => {
  it("re-derives categories from names and keeps pets tagged", () => {
    const snapshot = {
      items: [
        { id: "scythe", displayName: "Nik's Scythe", rarity: "godly", category: "other" },
        { id: "raygun", displayName: "Ray Gun", rarity: "godly", category: "other" },
        { id: "dog", displayName: "Robo Dog", rarity: "pet", category: "pet" },
        { id: "seer", displayName: "Seer", rarity: "godly", category: "other" },
      ],
    };
    const changed = reconcileCategories(snapshot);
    expect(changed).toBe(2);
    expect(snapshot.items[0].category).toBe("knife");
    expect(snapshot.items[1].category).toBe("gun");
    expect(snapshot.items[2].category).toBe("pet");
    expect(snapshot.items[3].category).toBe("other");
  });
});

describe("reconcile", () => {
  const now = "2026-08-01T00:00:00.000Z";

  function snapshotWith(value: number) {
    return {
      schemaVersion: 1,
      revision: 1,
      generatedAt: now,
      sources: ["mm2values"],
      items: [
        {
          id: "batwing",
          displayName: "Batwing",
          aliases: [],
          category: "other",
          rarity: "ancient",
          chroma: false,
          verified: true,
          values: { mm2values: { value, updatedAt: now } },
        },
      ],
    };
  }

  it("updates an item in place when the value changed", () => {
    const snap = snapshotWith(45);
    const rows = parseMm2Html(MM2_BLOCK, "ancient").slice(0, 1); // Batwing → 45
    const changedRows = rows.map((r) => ({ ...r, value: 60 }));

    const report = reconcile(snap, changedRows, "mm2values", { now, allowNewItems: true });
    expect(report.changed).toBe(1);
    expect(snap.items[0].values.mm2values.value).toBe(60);
    expect(snap.items[0].values.mm2values.previousValue).toBe(45);
  });

  it("matches disambiguated catalogue names by stable source item id", () => {
    const snap = snapshotWith(45);
    snap.items[0].displayName = "Batwing (Knife)";
    snap.items[0].values.mm2values.sourceItemId = "3";
    const rows = parseMm2Html(MM2_BLOCK, "ancient").slice(0, 1);
    rows[0].value = 60;
    const report = reconcile(snap, rows, "mm2values", { now, allowNewItems: true });
    expect(report.changed).toBe(1);
    expect(report.newItems).toBe(0);
    expect(snap.items).toHaveLength(1);
  });

  it("appends a rolling history point each time the value moves", () => {
    const snap = snapshotWith(45);
    const first = [{ name: "Batwing", value: 60, category: "ancient" }];
    reconcile(snap, first, "mm2values", { now, allowNewItems: true });
    // Seeds from the prior value then records the move → two points.
    expect(snap.items[0].values.mm2values.history.map((p) => p.value)).toEqual([45, 60]);

    const later = "2026-08-02T00:00:00.000Z";
    const second = [{ name: "Batwing", value: 75, category: "ancient" }];
    reconcile(snap, second, "mm2values", { now: later, allowNewItems: true });
    expect(snap.items[0].values.mm2values.history.map((p) => p.value)).toEqual([45, 60, 75]);
  });

  it("records one flat observation per UTC day", () => {
    const snap = snapshotWith(45);
    // A demand-only change still rewrites the reading but must not add a point.
    const demandOnly = [{ name: "Batwing", value: 45, demand: 8, category: "ancient" }];
    reconcile(snap, demandOnly, "mm2values", { now, allowNewItems: true });
    const history = snap.items[0].values.mm2values.history ?? [];
    expect(history.every((p) => p.value === 45)).toBe(true);
    expect(history).toHaveLength(1);

    const later = "2026-08-02T00:00:00.000Z";
    reconcile(snap, demandOnly, "mm2values", { now: later, allowNewItems: true });
    expect(snap.items[0].values.mm2values.history).toHaveLength(2);
  });

  it("clears previous-sync movement markers on a later flat sync", () => {
    const snap = snapshotWith(45);
    reconcile(snap, [{ name: "Batwing", value: 60, category: "ancient" }], "mm2values", {
      now,
      allowNewItems: true,
    });
    expect(snap.items[0].values.mm2values.previousValue).toBe(45);

    const report = reconcile(
      snap,
      [{ name: "Batwing", value: 60, category: "ancient" }],
      "mm2values",
      { now: "2026-08-02T00:00:00.000Z", allowNewItems: true },
    );

    expect(report.refreshed).toBe(1);
    expect(snap.items[0].values.mm2values.previousValue).toBeUndefined();
    expect(snap.items[0].values.mm2values.trendPercent).toBeUndefined();
    expect(snap.items[0].values.mm2values.history.map((point) => point.value)).toEqual([
      45, 60, 60,
    ]);
  });

  it("reports no change when the value is identical", () => {
    const snap = snapshotWith(45);
    const rows = [{ name: "Batwing", value: 45, category: "ancient" }]; // same value, no extra fields
    const report = reconcile(snap, rows, "mm2values", { now, allowNewItems: true });
    expect(report.changed).toBe(0);
    expect(report.refreshed).toBe(1);
    expect(report.newItems).toBe(0);
    expect(snap.items[0].values.mm2values.retrievedAt).toBe(now);
  });

  it("adds a brand-new item for mm2values but not for supreme", () => {
    const snap = snapshotWith(45);
    const seer = [{ name: "Seer", value: 100, category: "godly" }];

    const supremeReport = reconcile(snap, seer, "supreme", { now, allowNewItems: false });
    expect(supremeReport.newItems).toBe(0);
    expect(snap.items).toHaveLength(1);

    const mm2Report = reconcile(snap, seer, "mm2values", { now, allowNewItems: true });
    expect(mm2Report.newItems).toBe(1);
    expect(snap.items.map((i) => i.id)).toContain(slugify("Seer"));
  });
});
