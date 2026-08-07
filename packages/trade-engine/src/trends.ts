import type { Item, SourceId } from "@tradelens/item-schema";
import { computeDisagreement } from "./values.js";

/**
 * Helpers for the "Recently changed & trending" tab. Everything here is a pure
 * transform over the current snapshot so it can be recomputed cheaply.
 */

export interface TrendEntry {
  item: Item;
  source: SourceId;
  value: number;
  previousValue?: number;
  /** Signed percentage change since the previous value. */
  changePercent: number;
}

function changePercent(current: number, previous: number | undefined): number {
  if (previous === undefined || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/** Items with the largest movement (up or down) under a source. */
export function biggestMovers(
  items: Item[],
  source: SourceId,
  direction: "up" | "down" | "both" = "both",
  limit = 10,
): TrendEntry[] {
  const entries: TrendEntry[] = [];
  for (const item of items) {
    const v = item.values[source];
    if (!v) continue;
    const pct =
      typeof v.trendPercent === "number"
        ? v.trendPercent
        : changePercent(v.value, v.previousValue);
    if (pct === 0) continue;
    entries.push({
      item,
      source,
      value: v.value,
      previousValue: v.previousValue,
      changePercent: pct,
    });
  }

  const filtered = entries.filter((e) =>
    direction === "up"
      ? e.changePercent > 0
      : direction === "down"
        ? e.changePercent < 0
        : true,
  );
  filtered.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  return filtered.slice(0, limit);
}

/** Stable items with strong demand — good "safe hold" candidates. */
export function stableHighDemand(
  items: Item[],
  source: SourceId,
  minDemand = 4,
  limit = 10,
): Item[] {
  return items
    .filter((item) => {
      const v = item.values[source];
      return v && v.stability === "stable" && (v.demand ?? 0) >= minDemand;
    })
    .sort(
      (a, b) =>
        (b.values[source]?.demand ?? 0) - (a.values[source]?.demand ?? 0),
    )
    .slice(0, limit);
}

/** Items whose sources disagree the most — worth double-checking. */
export function mostContested(items: Item[], limit = 10): Item[] {
  return items
    .map((item) => {
      const values = Object.values(item.values).map((v) => v.value);
      return { item, disagreement: computeDisagreement(values) };
    })
    .filter((e) => e.disagreement > 0)
    .sort((a, b) => b.disagreement - a.disagreement)
    .slice(0, limit)
    .map((e) => e.item);
}
