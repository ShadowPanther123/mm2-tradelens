import type { Item } from "@tradelens/item-schema";
import { isHotlink } from "./assets.js";

/**
 * Attribution and licensing records for image assets.
 *
 * Every image an item points at must have a licensing record here so we can
 * prove we are permitted to ship it. Records are keyed by the asset reference
 * exactly as it appears on the item's `image` field (canonical local path,
 * data URI scheme, or — only where a source owner has agreed — an external
 * origin). The audit refuses to consider the catalogue clean while any
 * referenced image lacks a record.
 */

/** How we are permitted to use an asset. */
export type AssetPermission =
  | "owned" // Authored by the TradeLens project.
  | "public-domain" // CC0 / public domain.
  | "licensed" // Covered by a named licence we comply with.
  | "permission-granted" // The source owner explicitly permitted this use.
  | "system"; // Provided by the OS/font stack, not bundled.

export interface AssetLicense {
  /** Asset reference, matching an item's `image` value (or a scheme/prefix). */
  asset: string;
  /** Human-readable origin, e.g. "TradeLens", "MM2Values (with permission)". */
  source: string;
  /** Original URL, stored only where the source permits it. */
  sourceUrl?: string;
  /** SPDX identifier or short licence name, e.g. "CC0-1.0", "Apache-2.0". */
  license: string;
  /** Attribution text to display or bundle, if the licence requires it. */
  attribution?: string;
  /** The permission basis for shipping the asset. */
  permission: AssetPermission;
  /** Any conditions or review notes. */
  notes?: string;
}

export type AssetLicenseRegistry = readonly AssetLicense[];

/**
 * Baseline registry for the assets the app ships today. Item artwork is not
 * bundled yet — items fall back to the placeholder and category glyphs — so the
 * records below cover the icon *system* itself. Add a record here before
 * shipping any real item image.
 */
export const ASSET_LICENSES: AssetLicenseRegistry = [
  {
    asset: "icons/placeholder.svg",
    source: "TradeLens",
    license: "CC0-1.0",
    permission: "owned",
    notes: "Original missing-icon placeholder authored for TradeLens.",
  },
  {
    asset: "icons/items/",
    source: "MM2Values licensed export",
    license: "Source-owner permission",
    permission: "permission-granted",
    notes:
      "Bundled item artwork is restricted to files recorded by source URL, SHA-256, and byte size in data/icons-manifest.csv.",
  },
  {
    asset: "emoji:category",
    source: "System font / Unicode",
    license: "system",
    permission: "system",
    notes:
      "Category fallback glyphs are rendered from the operating system's emoji font; no artwork is bundled.",
  },
  {
    asset: "data:",
    source: "User-supplied",
    license: "N/A",
    permission: "owned",
    notes: "In-memory images the user provides (e.g. an OCR screenshot) are never redistributed.",
  },
];

/** Index a registry by asset reference for quick lookup. */
export function indexLicenses(registry: AssetLicenseRegistry): Map<string, AssetLicense> {
  const map = new Map<string, AssetLicense>();
  for (const record of registry) map.set(record.asset, record);
  return map;
}

/**
 * Find the licence record covering a reference. Exact matches win; otherwise a
 * scheme/prefix record (e.g. `data:`) may cover it.
 */
export function licenseFor(
  ref: string,
  registry: AssetLicenseRegistry = ASSET_LICENSES,
): AssetLicense | undefined {
  const index = indexLicenses(registry);
  if (index.has(ref)) return index.get(ref);
  for (const record of registry) {
    if ((record.asset.endsWith(":") || record.asset.endsWith("/")) && ref.startsWith(record.asset)) {
      return record;
    }
  }
  return undefined;
}

/** An image reference used by an item that has no covering licence record. */
export interface UnlicensedAsset {
  itemId: string;
  asset: string;
  /** True when the reference is an external URL, which additionally must not be hotlinked. */
  hotlink: boolean;
}

/**
 * Report every item image that lacks a licence record. Items with no image are
 * skipped (they fall back to the licensed placeholder).
 */
export function findUnlicensedAssets(
  items: readonly Item[],
  registry: AssetLicenseRegistry = ASSET_LICENSES,
): UnlicensedAsset[] {
  const out: UnlicensedAsset[] = [];
  for (const item of items) {
    if (!item.image) continue;
    if (licenseFor(item.image, registry)) continue;
    out.push({ itemId: item.id, asset: item.image, hotlink: isHotlink(item.image) });
  }
  return out.sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
}
