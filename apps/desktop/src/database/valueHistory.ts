import type { HistoryPoint } from "@/types";
import { getStorage } from "@/services/storage";

/**
 * Persist value-history points captured when a snapshot revision is adopted.
 * Duplicate (item, source, revision) points are ignored by the backend.
 */
export function recordValueHistory(points: HistoryPoint[]): Promise<void> {
  return getStorage().recordValueHistory(points);
}

/** Read the recorded value history for one item, oldest first. */
export function getValueHistory(itemId: string, limit?: number): Promise<HistoryPoint[]> {
  return getStorage().getValueHistory(itemId, limit);
}
