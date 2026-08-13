import { describe, expect, it } from "vitest";
import type { HistoryPoint, Item, PortfolioEntry } from "@/types";
import { summarizePortfolio } from "./portfolio";

const item: Item = {
  id: "harvester",
  displayName: "Harvester",
  aliases: [],
  category: "gun",
  rarity: "ancient",
  chroma: false,
  verified: true,
  values: { mm2values: { value: 120, updatedAt: "2026-08-12T00:00:00.000Z" } },
};
const entry: PortfolioEntry = {
  itemId: item.id,
  quantity: 2,
  baselineValue: 100,
  createdAt: "2026-08-01T00:00:00.000Z",
};
const history: HistoryPoint[] = [
  {
    itemId: item.id,
    source: "mm2values",
    value: 100,
    recordedAt: "2026-08-04T00:00:00.000Z",
    revision: 1,
  },
  {
    itemId: item.id,
    source: "mm2values",
    value: 110,
    recordedAt: "2026-08-11T00:00:00.000Z",
    revision: 2,
  },
  {
    itemId: item.id,
    source: "mm2values",
    value: 120,
    recordedAt: "2026-08-12T00:00:00.000Z",
    revision: 3,
  },
];

describe("summarizePortfolio", () => {
  it("totals inventory and daily/weekly movement", () => {
    const summary = summarizePortfolio(
      [entry],
      [item],
      history,
      "mm2values",
      Date.parse("2026-08-12T12:00:00.000Z"),
    );
    expect(summary.inventory).toBe(2);
    expect(summary.value).toBe(240);
    expect(summary.todayChange).toBe(20);
    expect(summary.weekChange).toBe(40);
  });
});
