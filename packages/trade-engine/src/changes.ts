import type { Item } from "@tradelens/item-schema";
import { resolveValue, roundValue, type SourceMode } from "./values.js";

/**
 * Detecting value movement between two sets of items (typically an old and a
 * new snapshot) so the app can alert on items whose worth has shifted.
 */

/** An item whose resolved value moved between two snapshots. */
export interface ValueChange {
  item: Item;
  /** Resolved value in the previous snapshot. */
  from: number;
  /** Resolved value in the new snapshot. */
  to: number;
  /** Signed change (to − from), rounded for display. */
  change: number;
  /** Signed percentage change; 0 when the previous value was 0. */
  changePercent: number;
}

/** Default alert threshold: report any absolute move of 5 or more. */
export const DEFAULT_CHANGE_THRESHOLD = 5;

/**
 * Compare two collections of items and report every item whose resolved value
 * moved by at least `minAbsChange` in absolute terms.
 *
 * This works for literally any item — pets, chroma, unique, vintage, ancient
 * and everything else — because it operates purely on resolved values rather
 * than on rarity or category. Items missing from either side, or with no
 * reading under `mode`, are skipped instead of being treated as a change from
 * zero, so a newly-added or newly-removed item never fires a false alert.
 *
 * Results are sorted by the size of the move, largest first.
 */
export function detectValueChanges(
  previous: Iterable<Item>,
  next: Iterable<Item>,
  mode: SourceMode,
  minAbsChange: number = DEFAULT_CHANGE_THRESHOLD,
  now: number = Date.now(),
): ValueChange[] {
  const prevValues = new Map<string, number>();
  for (const item of previous) {
    const resolved = resolveValue(item, mode, now);
    if (resolved) prevValues.set(item.id, resolved.value);
  }

  const threshold = Math.max(0, minAbsChange);
  const changes: ValueChange[] = [];
  for (const item of next) {
    const from = prevValues.get(item.id);
    if (from === undefined) continue;
    const resolved = resolveValue(item, mode, now);
    if (!resolved) continue;
    const delta = resolved.value - from;
    if (Math.abs(delta) < threshold) continue;
    changes.push({
      item,
      from,
      to: resolved.value,
      change: roundValue(delta),
      changePercent: from === 0 ? 0 : (delta / from) * 100,
    });
  }

  changes.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  return changes;
}
