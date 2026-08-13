import { getStorage } from "@/services/storage";
import type { PortfolioEntry } from "@/types";

export function listPortfolio(): Promise<PortfolioEntry[]> {
  return getStorage().listPortfolio();
}

export function upsertPortfolioEntry(
  itemId: string,
  quantity: number,
  baselineValue: number,
): Promise<void> {
  return getStorage().upsertPortfolioEntry(itemId, quantity, baselineValue);
}

export function removePortfolioEntry(itemId: string): Promise<void> {
  return getStorage().removePortfolioEntry(itemId);
}
