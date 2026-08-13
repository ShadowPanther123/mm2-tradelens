import { getStorage } from "@/services/storage";
import type { SearchStat } from "@/types";

export function listSearchStats(): Promise<SearchStat[]> {
  return getStorage().listSearchStats();
}

export function recordSearch(itemId: string): Promise<void> {
  return getStorage().recordSearch(itemId);
}
