import type { HistoryPoint, Item } from "@/types";

export type HistoryWindow = 7 | 30 | 90;

export interface ChartPoint {
  value: number;
  recordedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function validPoint(value: number, recordedAt: string): boolean {
  return Number.isFinite(value) && !Number.isNaN(Date.parse(recordedAt));
}

function collapsePoints(points: readonly ChartPoint[], byDay: boolean): ChartPoint[] {
  const buckets = new Map<string, { sum: number; count: number; recordedAt: string }>();
  for (const point of points) {
    const key = byDay ? point.recordedAt.slice(0, 10) : point.recordedAt;
    const current = buckets.get(key);
    if (current) {
      current.sum += point.value;
      current.count += 1;
      if (Date.parse(point.recordedAt) > Date.parse(current.recordedAt)) {
        current.recordedAt = point.recordedAt;
      }
    } else {
      buckets.set(key, { sum: point.value, count: 1, recordedAt: point.recordedAt });
    }
  }
  return [...buckets.values()].map((point) => ({
    value: point.sum / point.count,
    recordedAt: point.recordedAt,
  }));
}

/** Merge snapshot-embedded and device-recorded readings into one ordered series. */
export function buildItemHistory(
  item: Item,
  local: readonly HistoryPoint[],
  source?: string,
): ChartPoint[] {
  const embedded: ChartPoint[] = [];
  for (const [sourceId, reading] of Object.entries(item.values)) {
    if (source && sourceId !== source) continue;
    for (const point of reading.history ?? []) {
      if (validPoint(point.value, point.at)) {
        embedded.push({ value: point.value, recordedAt: point.at });
      }
    }
    const currentAt = reading.retrievedAt ?? reading.updatedAt;
    if (validPoint(reading.value, currentAt)) {
      embedded.push({ value: reading.value, recordedAt: currentAt });
    }
  }

  const localByRevision = new Map<number, { sum: number; count: number; at: string }>();
  for (const point of local) {
    if (source && point.source !== source) continue;
    if (!validPoint(point.value, point.recordedAt)) continue;
    const current = localByRevision.get(point.revision);
    if (current) {
      current.sum += point.value;
      current.count += 1;
      if (Date.parse(point.recordedAt) > Date.parse(current.at))
        current.at = point.recordedAt;
    } else {
      localByRevision.set(point.revision, {
        sum: point.value,
        count: 1,
        at: point.recordedAt,
      });
    }
  }

  const merged = [
    ...collapsePoints(embedded, source === undefined),
    ...[...localByRevision.values()].map((point) => ({
      value: point.sum / point.count,
      recordedAt: point.at,
    })),
  ].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  const seen = new Set<string>();
  return merged.filter((point) => {
    const key = `${point.recordedAt}\u0000${point.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Keep a baseline before the cutoff so each range shows the full window change. */
export function historyForWindow(
  points: readonly ChartPoint[],
  days: HistoryWindow,
  now = Date.now(),
): ChartPoint[] {
  const cutoff = now - days * DAY_MS;
  const inside = points.filter((point) => Date.parse(point.recordedAt) >= cutoff);
  const baseline = points
    .filter((point) => Date.parse(point.recordedAt) < cutoff)
    .at(-1);
  return baseline ? [baseline, ...inside] : inside;
}
