import type { TradeRecord } from "@/types";
import { getStorage } from "@/services/storage";

/** List saved trades, newest first. */
export function listHistory(): Promise<TradeRecord[]> {
  return getStorage().listHistory();
}

/** Persist a trade record. */
export function addHistoryRecord(record: TradeRecord): Promise<void> {
  return getStorage().addHistoryRecord(record);
}

/** Delete a trade record by id. */
export function removeHistoryRecord(id: string): Promise<void> {
  return getStorage().removeHistoryRecord(id);
}
