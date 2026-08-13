import { describe, expect, it } from "vitest";
import type { HistoryPoint, Item } from "@/types";
import { buildItemHistory, historyForWindow } from "@/utils/valueHistory";

const item: Item = {
  id: "seer",
  displayName: "Seer",
  aliases: [],
  category: "knife",
  rarity: "godly",
  chroma: false,
  verified: true,
  values: {
    mm2values: {
      value: 12,
      updatedAt: "2026-08-10T00:00:00.000Z",
      history: [
        { value: 10, at: "2026-07-01T00:00:00.000Z" },
        { value: 11, at: "2026-08-05T00:00:00.000Z" },
        { value: 12, at: "2026-08-10T00:00:00.000Z" },
      ],
    },
  },
};

describe("item value history", () => {
  it("merges embedded and local readings in time order", () => {
    const local: HistoryPoint[] = [
      {
        itemId: "seer",
        source: "mm2values",
        value: 13,
        recordedAt: "2026-08-11T00:00:00.000Z",
        revision: 2,
      },
    ];
    expect(
      buildItemHistory(item, local, "mm2values").map((point) => point.value),
    ).toEqual([10, 11, 12, 13]);
  });

  it("supports 7, 30 and 90-day windows with a prior baseline", () => {
    const points = buildItemHistory(item, [], "mm2values");
    const now = Date.parse("2026-08-12T00:00:00.000Z");
    expect(historyForWindow(points, 7, now).map((point) => point.value)).toEqual([
      10, 11, 12,
    ]);
    expect(historyForWindow(points, 30, now).map((point) => point.value)).toEqual([
      10, 11, 12,
    ]);
    expect(historyForWindow(points, 90, now).map((point) => point.value)).toEqual([
      10, 11, 12,
    ]);
  });
});
