import type { Item, TradeRecord } from "@/types";

/**
 * Trade-history querying and maintenance helpers.
 *
 * All pure functions so they can be unit-tested without a DOM or storage. The
 * verdict of a historical trade is derived from the record's stored result, not
 * recomputed against current values, so history stays faithful to what the user
 * saw at the time.
 */

/** Coarse verdict bucket derived from a stored result percentage. */
export type HistoryVerdict = "big-win" | "win" | "fair" | "loss" | "big-loss" | "unknown";

/** Map a stored result percentage to a verdict bucket. */
export function verdictFromPercent(pct: number): HistoryVerdict {
  if (pct >= 15) return "big-win";
  if (pct >= 5) return "win";
  if (pct > -5) return "fair";
  if (pct > -15) return "loss";
  return "big-loss";
}

/** Use the exact verdict shown when saved; legacy records use the old summary. */
export function verdictForRecord(record: TradeRecord): HistoryVerdict {
  return record.calculation?.adjustedVerdict ?? verdictFromPercent(record.resultPercent);
}

/** Outcome filter for the history view. */
export type OutcomeFilter = "all" | "wins" | "fair" | "losses";

export interface HistoryFilter {
  /** Free-text query matched against item names on either side. */
  query?: string;
  /** Restrict to a coarse outcome group. */
  outcome?: OutcomeFilter;
  /** Restrict to a specific source mode. */
  mode?: string;
}

function matchesOutcome(record: TradeRecord, outcome: OutcomeFilter): boolean {
  const verdict = verdictForRecord(record);
  switch (outcome) {
    case "wins":
      return verdict === "win" || verdict === "big-win";
    case "losses":
      return verdict === "loss" || verdict === "big-loss";
    case "fair":
      return verdict === "fair";
    default:
      return true;
  }
}

/** All item ids referenced by a record, both sides. */
function recordItemIds(record: TradeRecord): string[] {
  return [...record.gave, ...record.received].map((s) => s.itemId);
}

/**
 * Filter trade history by free-text item name, outcome group and source mode.
 * `nameOf` resolves an item id to its current display name for text matching;
 * the raw id is always searchable too, so retired items remain findable.
 */
export function filterHistory(
  history: readonly TradeRecord[],
  filter: HistoryFilter,
  nameOf: (id: string) => Item | undefined,
): TradeRecord[] {
  const query = filter.query?.trim().toLowerCase() ?? "";
  return history.filter((record) => {
    if (filter.mode && filter.mode !== "all" && record.mode !== filter.mode) return false;
    if (filter.outcome && !matchesOutcome(record, filter.outcome)) return false;
    if (query) {
      const haystack = recordItemIds(record)
        .map((id) => `${id} ${nameOf(id)?.displayName ?? ""}`.toLowerCase())
        .join(" ");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** Current schema version of the history export envelope. */
export const HISTORY_EXPORT_VERSION = 1 as const;

export interface HistoryExport {
  kind: "tradelens-history";
  version: number;
  exportedAt: string;
  history: TradeRecord[];
}

/** Serialise trade history to a portable, versioned JSON string. */
export function exportHistory(
  history: readonly TradeRecord[],
  now: Date = new Date(),
): string {
  const payload: HistoryExport = {
    kind: "tradelens-history",
    version: HISTORY_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    history: [...history],
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Apply a retention limit, keeping the newest `limit` records. A limit of 0 (or
 * negative) means unlimited and returns the list unchanged. Records are assumed
 * to be newest-first, matching how they are stored and listed.
 */
export function applyRetention(
  history: readonly TradeRecord[],
  limit: number,
): TradeRecord[] {
  if (!Number.isFinite(limit) || limit <= 0) return [...history];
  return history.slice(0, Math.floor(limit));
}

/**
 * Ids of records that exceed the retention limit and should be pruned from
 * storage. Empty when the limit is unlimited or not yet exceeded.
 */
export function recordsToPrune(
  history: readonly TradeRecord[],
  limit: number,
): string[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return history.slice(Math.floor(limit)).map((r) => r.id);
}
