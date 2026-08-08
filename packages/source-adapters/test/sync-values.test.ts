import { describe, expect, it } from "vitest";
// The sync tool is a runnable .mjs script; import its pure helpers directly.
// (The package typechecks only `src`, so importing the script here is fine.)
import {
  parseMm2Html,
  parseSupremePayload,
  parseSupremeHtml,
  parseSupremeText,
  parseValueToken,
  reconcile,
  slugify,
  mapStability,
  cleanStabilityLabel,
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
    expect(wrapped).toEqual([{ name: "Seer", value: 100, demand: 5, rarity: undefined, stability: undefined }]);

    const bare = parseSupremePayload([{ name: "Seer", value: 100 }]);
    expect(bare[0]).toMatchObject({ name: "Seer", value: 100 });
  });

  it("skips entries missing a name or numeric value", () => {
    const rows = parseSupremePayload([{ value: 1 }, { name: "X" }, { name: "Y", value: "nope" }]);
    expect(rows).toEqual([]);
  });
});

describe("parseSupremeHtml", () => {
  // Mirrors the real SupremeValues item markup (head + body pair).
  const SUPREME_HTML = `
    <div class="itemhead">Chroma Evergun</div>
    <div class="itembody"> Value -
      <b class="itemvalue val-top">75,000</b>
      <span class="inv-calc-hide">x</span>
      <b class="itemrange">[N/A]</b><br>
      Stability - <b class="itemstability stable">Stable</b>
      <img src="../media/stability/Stable.webp" alt="Item stability"><br>
      Demand - <b>8</b>
    </div>
    <div class="itemhead">Seer</div>
    <div class="itembody"> Value -
      <b class="itemvalue">1,200</b>
      <b class="itemrange">[N/A]</b><br>
      Stability - <b class="itemstability fluctuating">Fluctuating</b><br>
      Demand - <b>5</b> Rarity - <b>4</b>
    </div>
  `;

  it("extracts name, value, stability and demand from item blocks", () => {
    const rows = parseSupremeHtml(SUPREME_HTML);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Chroma Evergun",
      value: 75000,
      stability: "Stable",
      demand: 8,
    });
    expect(rows[1]).toMatchObject({
      name: "Seer",
      value: 1200,
      stability: "Fluctuating",
      demand: 5,
      rarity: 4,
    });
  });

  it("returns nothing for a bot-protection challenge page", () => {
    expect(parseSupremeHtml("<html><body>Please enable JavaScript</body></html>")).toEqual([]);
  });
});

describe("parseValueToken", () => {
  it("handles plain, comma-grouped and K/M/B suffixed values", () => {
    expect(parseValueToken("125")).toBe(125);
    expect(parseValueToken("36,250")).toBe(36250);
    expect(parseValueToken("124K")).toBe(124000);
    expect(parseValueToken("1.2M")).toBe(1200000);
    expect(parseValueToken("2B")).toBe(2000000000);
  });
});

describe("parseSupremeText", () => {
  // Mirrors a SupremeValues category page copied via document.body.innerText.
  const SUPREME_TEXT = `
Chroma Tier
Chroma Ever Set
Value - 124K [123K - 124K]
Stability - Underpaid For 
Demand - 8Rarity - 8
Change in Value - (-1,000) -0.8%
+1 -1 ~
Chroma Alien Set
Value - 36,250 [N/A]
Stability - Stable 
Demand - 6Rarity - 6
Change in Value - (+250) +0.7%
+1 -1 ~
`;

  it("extracts items with K-suffix values, demand, rarity and stability", () => {
    const rows = parseSupremeText(SUPREME_TEXT);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "Chroma Ever Set",
      value: 124000,
      stability: "Underpaid For",
      demand: 8,
      rarity: 8,
    });
    expect(rows[1]).toMatchObject({ name: "Chroma Alien Set", value: 36250 });
  });

  it("skips tier/section headers", () => {
    const rows = parseSupremeText(SUPREME_TEXT);
    expect(rows.map((r) => r.name)).not.toContain("Chroma Tier");
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

  it("reports no change when the value is identical", () => {
    const snap = snapshotWith(45);
    const rows = [{ name: "Batwing", value: 45, category: "ancient" }]; // same value, no extra fields
    const report = reconcile(snap, rows, "mm2values", { now, allowNewItems: true });
    expect(report.changed).toBe(0);
    expect(report.newItems).toBe(0);
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
