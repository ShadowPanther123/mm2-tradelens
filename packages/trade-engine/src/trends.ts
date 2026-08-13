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

/** One recorded reading in an item's value-history time series. */
export interface HistoryReading {
  source: SourceId | string;
  value: number;
  revision: number;
  recordedAt: string;
}

/** A mover derived from the recorded value-history time series. */
export interface HistoryMover {
  item: Item;
  source: SourceId;
  /** Values across the window, oldest first — ready to feed a sparkline. */
  series: number[];
  /** Latest value in the window. */
  value: number;
  /** Baseline (oldest) value the change is measured from. */
  previousValue: number;
  /** Signed percentage change across the window. */
  changePercent: number;
  /** Signed absolute change across the window. */
  changeAbsolute: number;
  /** ISO timestamp of the latest reading in the window. */
  recordedAt: string;
}

export interface HistoryMoverOptions {
  direction?: "up" | "down" | "both";
  limit?: number;
  /** Only include readings recorded within this many days of `now`. */
  days?: number;
  /** Cap each item's window to its most recent N readings. */
  maxPoints?: number;
  /** Reference time in ms (defaults to `Date.now()`); injectable for tests. */
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Merge history sources without discarding older embedded readings. */
export function mergeHistoryReadings(
  ...groups: readonly (readonly HistoryReading[])[]
): HistoryReading[] {
  const seen = new Set<string>();
  const merged: HistoryReading[] = [];
  for (const group of groups) {
    for (const reading of group) {
      const key = `${reading.source}\u0000${reading.value}\u0000${reading.recordedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(reading);
    }
  }
  return merged.sort((a, b) => {
    const byTime = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
    return byTime !== 0 ? byTime : a.revision - b.revision;
  });
}

/**
 * Derive a history-reading map from the rolling `history` series the value sync
 * embeds in each snapshot reading. Lets the Trends view show movement offline,
 * straight from the bundled snapshot, before any local points are recorded.
 */
export function snapshotHistory(items: Item[], source: SourceId): Map<string, HistoryReading[]> {
  const map = new Map<string, HistoryReading[]>();
  for (const item of items) {
    const reading = item.values[source];
    if (!reading) continue;
    const series = reading.history;
    if (series && series.length > 0) {
      map.set(
        item.id,
        series.map((p, i) => ({ source, value: p.value, revision: i, recordedAt: p.at })),
      );
      continue;
    }
    // Fallback for snapshots synced before rolling history was recorded: derive
    // a two-point series from the last-sync previous value so recent movers are
    // still visible immediately.
    if (typeof reading.previousValue === "number" && reading.previousValue !== reading.value) {
      map.set(item.id, [
        { source, value: reading.previousValue, revision: 0, recordedAt: reading.updatedAt },
        { source, value: reading.value, revision: 1, recordedAt: reading.updatedAt },
      ]);
    }
  }
  return map;
}

/**
 * Compute movers from the locally recorded value-history series rather than the
 * single previous-sync delta in the snapshot. This surfaces movement across a
 * multi-revision window (e.g. the last 7 days) and hands back a full series so
 * the UI can draw a real sparkline instead of a two-point line.
 */
export function historyMovers(
  items: Item[],
  history: Map<string, HistoryReading[]>,
  source: SourceId,
  options: HistoryMoverOptions = {},
): HistoryMover[] {
  const { direction = "both", limit = 10, days, maxPoints, now = Date.now() } = options;
  const cutoff = days !== undefined ? now - days * DAY_MS : undefined;

  const movers: HistoryMover[] = [];
  for (const item of items) {
    const readings = (history.get(item.id) ?? [])
      .filter((r) => r.source === source)
      .sort((a, b) => {
        const byTime = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
        return byTime !== 0 ? byTime : a.revision - b.revision;
      });

    let windowed = readings;
    if (cutoff !== undefined) {
      const inside = readings.filter((r) => Date.parse(r.recordedAt) >= cutoff);
      const baseline = readings.filter((r) => Date.parse(r.recordedAt) < cutoff).at(-1);
      windowed = baseline ? [baseline, ...inside] : inside;
    }
    if (maxPoints !== undefined && windowed.length > maxPoints) {
      windowed = windowed.slice(windowed.length - maxPoints);
    }
    if (windowed.length < 2) continue;

    const first = windowed[0];
    const last = windowed[windowed.length - 1];
    if (first.value === last.value) continue;

    const changeAbsolute = last.value - first.value;
    const changePercent = first.value > 0 ? (changeAbsolute / first.value) * 100 : 0;
    if (changePercent === 0) continue;

    movers.push({
      item,
      source,
      series: windowed.map((r) => r.value),
      value: last.value,
      previousValue: first.value,
      changePercent,
      changeAbsolute,
      recordedAt: last.recordedAt,
    });
  }

  const filtered = movers.filter((m) =>
    direction === "up" ? m.changePercent > 0 : direction === "down" ? m.changePercent < 0 : true,
  );
  filtered.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  return filtered.slice(0, limit);
}

/**
 * Rank only headline value changes from the newest adopted sync while retaining
 * the selected historical window as the sparkline series.
 */
export function latestSyncMovers(
  items: Item[],
  history: Map<string, HistoryReading[]>,
  source: SourceId,
  options: HistoryMoverOptions = {},
): HistoryMover[] {
  const { direction = "both", limit = 10, days, maxPoints, now = Date.now() } = options;
  const cutoff = days !== undefined ? now - days * DAY_MS : undefined;
  const movers: HistoryMover[] = [];

  for (const item of items) {
    const value = item.values[source];
    if (!value || typeof value.previousValue !== "number" || value.previousValue === value.value) {
      continue;
    }

    const readings = (history.get(item.id) ?? [])
      .filter((reading) => reading.source === source)
      .sort((a, b) => {
        const byTime = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
        return byTime !== 0 ? byTime : a.revision - b.revision;
      });
    let windowed = readings;
    if (cutoff !== undefined) {
      const inside = readings.filter((reading) => Date.parse(reading.recordedAt) >= cutoff);
      const baseline = readings.filter((reading) => Date.parse(reading.recordedAt) < cutoff).at(-1);
      windowed = baseline ? [baseline, ...inside] : inside;
    }
    if (maxPoints !== undefined && windowed.length > maxPoints) {
      windowed = windowed.slice(windowed.length - maxPoints);
    }

    const changeAbsolute = value.value - value.previousValue;
    const changePercent =
      typeof value.trendPercent === "number"
        ? value.trendPercent
        : value.previousValue > 0
          ? (changeAbsolute / value.previousValue) * 100
          : 0;
    if (changePercent === 0) continue;

    const series =
      windowed.length >= 2
        ? windowed.map((reading) => reading.value)
        : [value.previousValue, value.value];
    movers.push({
      item,
      source,
      series,
      value: value.value,
      previousValue: value.previousValue,
      changePercent,
      changeAbsolute,
      recordedAt: value.updatedAt,
    });
  }

  const filtered = movers.filter((mover) =>
    direction === "up"
      ? mover.changePercent > 0
      : direction === "down"
        ? mover.changePercent < 0
        : true,
  );
  filtered.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  return filtered.slice(0, limit);
}

/** Rank newest-sync movers by raw value changed while keeping their graph series. */
export function latestSyncAbsoluteMovers(
  items: Item[],
  history: Map<string, HistoryReading[]>,
  source: SourceId,
  options: HistoryMoverOptions = {},
): HistoryMover[] {
  const { limit = 10, ...rest } = options;
  const movers = latestSyncMovers(items, history, source, {
    ...rest,
    limit: Number.MAX_SAFE_INTEGER,
  });
  movers.sort((a, b) => Math.abs(b.changeAbsolute) - Math.abs(a.changeAbsolute));
  return movers.slice(0, limit);
}

/**
 * Like {@link historyMovers} but ranked by absolute value moved rather than
 * percentage — highlights the largest swings in raw trading units.
 */
export function biggestAbsoluteMovers(
  items: Item[],
  history: Map<string, HistoryReading[]>,
  source: SourceId,
  options: HistoryMoverOptions = {},
): HistoryMover[] {
  const { limit = 10, ...rest } = options;
  const movers = historyMovers(items, history, source, { ...rest, limit: Number.MAX_SAFE_INTEGER });
  movers.sort((a, b) => Math.abs(b.changeAbsolute) - Math.abs(a.changeAbsolute));
  return movers.slice(0, limit);
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
      typeof v.trendPercent === "number" ? v.trendPercent : changePercent(v.value, v.previousValue);
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
    direction === "up" ? e.changePercent > 0 : direction === "down" ? e.changePercent < 0 : true,
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
    .sort((a, b) => (b.values[source]?.demand ?? 0) - (a.values[source]?.demand ?? 0))
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
