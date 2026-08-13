import { resolveValue } from "@tradelens/trade-engine";
import type { HistoryPoint, Item, PortfolioEntry } from "@/types";
import { toEngineMode } from "@/utils/sourceMode";
import { buildItemHistory } from "@/utils/valueHistory";
import type { SourceMode } from "@/types";

export interface PortfolioSummary {
  inventory: number;
  uniqueItems: number;
  value: number;
  todayChange: number;
  weekChange: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function valueAt(
  points: ReturnType<typeof buildItemHistory>,
  cutoff: number,
): number | undefined {
  return points.filter((point) => Date.parse(point.recordedAt) <= cutoff).at(-1)?.value;
}

export function summarizePortfolio(
  entries: readonly PortfolioEntry[],
  items: readonly Item[],
  history: readonly HistoryPoint[],
  mode: SourceMode,
  now = Date.now(),
): PortfolioSummary {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const historyMap = new Map<string, HistoryPoint[]>();
  for (const point of history) {
    const bucket = historyMap.get(point.itemId);
    if (bucket) bucket.push(point);
    else historyMap.set(point.itemId, [point]);
  }
  const engineMode = toEngineMode(mode);
  const source = engineMode === "consensus" ? undefined : engineMode;
  let value = 0;
  let dayValue = 0;
  let weekValue = 0;
  let inventory = 0;

  for (const entry of entries) {
    const item = itemMap.get(entry.itemId);
    if (!item) continue;
    const current = resolveValue(item, engineMode)?.value ?? entry.baselineValue;
    const points = buildItemHistory(item, historyMap.get(entry.itemId) ?? [], source);
    const day = valueAt(points, now - DAY_MS) ?? current;
    const week = valueAt(points, now - 7 * DAY_MS) ?? day;
    inventory += entry.quantity;
    value += current * entry.quantity;
    dayValue += day * entry.quantity;
    weekValue += week * entry.quantity;
  }

  return {
    inventory,
    uniqueItems: entries.length,
    value,
    todayChange: value - dayValue,
    weekChange: value - weekValue,
  };
}
