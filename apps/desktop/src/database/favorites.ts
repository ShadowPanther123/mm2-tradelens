import type { Favorite } from "@/types";
import { getStorage } from "@/services/storage";

/** List all favorites, newest first. */
export function listFavorites(): Promise<Favorite[]> {
  return getStorage().listFavorites();
}

/** Add or update a favorite with its baseline value. */
export function addFavorite(itemId: string, baselineValue: number): Promise<void> {
  return getStorage().addFavorite(itemId, baselineValue);
}

/** Remove a favorite by item id. */
export function removeFavorite(itemId: string): Promise<void> {
  return getStorage().removeFavorite(itemId);
}
