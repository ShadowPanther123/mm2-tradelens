import type { Favorite, Item } from "@/types";

/**
 * Favorites resilience helpers.
 *
 * Favorites are stored by canonical item id, never by display name, so an item
 * rename (which only changes `displayName`) never loses a favorite. This module
 * also copes with two harder cases that arise when a value snapshot updates:
 *
 *  - **Remapped items** — an item's id changed but the old id survives in the
 *    new item's `aliases`. The favorite is transparently re-pointed.
 *  - **Retired items** — the id no longer exists anywhere. The favorite is kept
 *    (never silently dropped) and surfaced so the user can decide what to do.
 */

export type FavoriteStatus = "active" | "remapped" | "retired";

/** A favorite paired with the current item it resolves to (if any). */
export interface ResolvedFavorite {
  favorite: Favorite;
  /** The current item, resolved directly or via an alias remap. */
  item?: Item;
  status: FavoriteStatus;
  /** When remapped, the current canonical id the favorite now points at. */
  remappedTo?: string;
}

/** Build an index from every known alias/old-id to its current item. */
function buildAliasIndex(items: readonly Item[]): Map<string, Item> {
  const index = new Map<string, Item>();
  for (const item of items) {
    for (const alias of item.aliases ?? []) {
      // Don't let an alias shadow a real current id.
      if (!index.has(alias)) index.set(alias, item);
    }
  }
  return index;
}

/**
 * Resolve every favorite against the current catalogue, classifying each as
 * active, remapped or retired. Order is preserved.
 */
export function resolveFavorites(
  favorites: readonly Favorite[],
  items: readonly Item[],
): ResolvedFavorite[] {
  const byId = new Map<string, Item>();
  for (const item of items) byId.set(item.id, item);
  const byAlias = buildAliasIndex(items);

  return favorites.map((favorite) => {
    const direct = byId.get(favorite.itemId);
    if (direct) return { favorite, item: direct, status: "active" as const };

    const remapped = byAlias.get(favorite.itemId);
    if (remapped) {
      return {
        favorite,
        item: remapped,
        status: "remapped" as const,
        remappedTo: remapped.id,
      };
    }

    return { favorite, status: "retired" as const };
  });
}

/** The canonical id a favorite should be stored under after resolution. */
export function canonicalFavoriteId(resolved: ResolvedFavorite): string {
  return resolved.remappedTo ?? resolved.favorite.itemId;
}

/**
 * Remove duplicate favorites, keeping the first occurrence of each canonical
 * id. Used defensively on import and when persisting a remap.
 */
export function dedupeFavorites(favorites: readonly Favorite[]): Favorite[] {
  const seen = new Set<string>();
  const out: Favorite[] = [];
  for (const fav of favorites) {
    if (seen.has(fav.itemId)) continue;
    seen.add(fav.itemId);
    out.push(fav);
  }
  return out;
}

/** Current schema version of the favorites export envelope. */
export const FAVORITES_EXPORT_VERSION = 1 as const;

export interface FavoritesExport {
  kind: "tradelens-favorites";
  version: number;
  exportedAt: string;
  favorites: Favorite[];
}

/** Serialise favorites to a portable, versioned JSON string. */
export function exportFavorites(
  favorites: readonly Favorite[],
  now: Date = new Date(),
): string {
  const payload: FavoritesExport = {
    kind: "tradelens-favorites",
    version: FAVORITES_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    favorites: dedupeFavorites(favorites),
  };
  return JSON.stringify(payload, null, 2);
}

function isValidFavorite(value: unknown): value is Favorite {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<Favorite>;
  return (
    typeof f.itemId === "string" &&
    f.itemId.length > 0 &&
    typeof f.baselineValue === "number" &&
    Number.isFinite(f.baselineValue) &&
    typeof f.createdAt === "string"
  );
}

/**
 * Parse a favorites export string, validating the envelope and every record.
 * Invalid entries are skipped; duplicates are removed. Throws only when the
 * payload is not a recognisable favorites export at all.
 */
export function parseFavoritesImport(json: string): Favorite[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("File is not valid JSON.");
  }

  // Accept either the full envelope or a bare array of favorites.
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as Partial<FavoritesExport>)?.kind === "tradelens-favorites"
      ? ((parsed as FavoritesExport).favorites ?? [])
      : null;

  if (!Array.isArray(list)) {
    throw new Error("This does not look like a TradeLens favorites export.");
  }

  return dedupeFavorites(list.filter(isValidFavorite));
}

/**
 * Merge imported favorites into an existing set without creating duplicates.
 * Existing favorites win, so an import never overwrites a live baseline.
 */
export function mergeFavorites(
  existing: readonly Favorite[],
  incoming: readonly Favorite[],
): { merged: Favorite[]; added: number } {
  const known = new Set(existing.map((f) => f.itemId));
  const additions = dedupeFavorites(incoming).filter((f) => !known.has(f.itemId));
  return { merged: [...existing, ...additions], added: additions.length };
}
