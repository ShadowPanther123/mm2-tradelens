import type {
  Item,
  ItemCategory,
  ItemRarity,
  SourceId,
  SourceValue,
  Stability,
  ValueSnapshot,
  ExtractionMethod,
} from "@tradelens/item-schema";

/**
 * Source adapters normalise the various shapes each value list publishes into
 * the single canonical Item schema. Real adapters would fetch from an approved
 * feed or licensed partner; here they take already-fetched rows so the
 * transform is pure, testable and side-effect free.
 */

/** The minimal, source-agnostic shape an adapter must produce per item. */
export interface RawRow {
  name: string;
  aliases?: string[];
  category: ItemCategory;
  rarity: ItemRarity;
  origin?: string;
  year?: number;
  chroma?: boolean;
  image?: string;
  value: number;
  demand?: number;
  rarityScore?: number;
  stability?: Stability;
  trendPercent?: number;
  previousValue?: number;
  /** ISO 8601 timestamp from the source. */
  updatedAt: string;
  /** The id this item has in the source's own system, if known. */
  sourceItemId?: string;
  /** Original source page/record URL, where the source permits storing it. */
  sourceUrl?: string;
  /** When the row was retrieved from the source (ISO 8601). */
  retrievedAt?: string;
  /** How the row was obtained. */
  extractionMethod?: ExtractionMethod;
  /** Whether this row is from a trusted source (false for manual entry). */
  verified?: boolean;
}

/** Turn a display name into a stable slug id. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toSourceValue(row: RawRow, importedAt: string, adapterVersion?: string): SourceValue {
  return {
    value: row.value,
    demand: row.demand,
    rarityScore: row.rarityScore,
    stability: row.stability,
    trendPercent: row.trendPercent,
    previousValue: row.previousValue,
    updatedAt: row.updatedAt,
    importedAt,
    retrievedAt: row.retrievedAt,
    sourceItemId: row.sourceItemId,
    sourceUrl: row.sourceUrl,
    adapterVersion,
    extractionMethod: row.extractionMethod,
    validation: "ok",
    reviewStatus: "unreviewed",
  };
}

/**
 * Merge rows from several sources into canonical items, keyed by slug. Item
 * metadata (category, rarity, origin) is taken from the first source that
 * provides it; each source contributes its own reading under `values`.
 *
 * Rows that cannot be mapped (e.g. an empty name that slugifies to nothing) are
 * skipped and reported through `onMappingFailure` so the caller can log them,
 * rather than silently corrupting the catalogue.
 */
export function mergeSources(
  bySource: Partial<Record<SourceId, RawRow[]>>,
  importedAt: string = new Date().toISOString(),
  adapterVersions: Partial<Record<SourceId, string>> = {},
  onMappingFailure: (failure: MappingFailure) => void = defaultLogMappingFailure,
): Item[] {
  const items = new Map<string, Item>();

  for (const [source, rows] of Object.entries(bySource) as Array<[SourceId, RawRow[]]>) {
    if (!rows) continue;
    for (const [i, row] of rows.entries()) {
      const id = slugify(row.name ?? "");
      if (!id) {
        onMappingFailure({
          source,
          index: i,
          name: row.name,
          reason: "name is empty or produced an empty slug",
        });
        continue;
      }
      const existing = items.get(id);
      const sourceValue = toSourceValue(row, importedAt, adapterVersions[source]);

      if (existing) {
        existing.values[source] = sourceValue;
        // A single unverified reading marks the whole item unverified.
        if (row.verified === false) existing.verified = false;
        // Fill in metadata gaps from later sources.
        if (!existing.origin && row.origin) existing.origin = row.origin;
        if (existing.year === undefined && row.year !== undefined) existing.year = row.year;
        for (const alias of row.aliases ?? []) {
          if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
        }
      } else {
        items.set(id, {
          id,
          displayName: row.name,
          aliases: [...(row.aliases ?? [])],
          category: row.category,
          rarity: row.rarity,
          origin: row.origin,
          year: row.year,
          chroma: row.chroma ?? false,
          image: row.image,
          verified: row.verified ?? true,
          values: { [source]: sourceValue } as Item["values"],
        });
      }
    }
  }

  return [...items.values()];
}

/** A row that could not be mapped into the canonical schema. */
export interface MappingFailure {
  source: SourceId;
  /** Index of the row within its source batch. */
  index: number;
  /** The offending name, if any. */
  name?: string;
  reason: string;
}

/** Default failure handler: log to the console without throwing. */
function defaultLogMappingFailure(failure: MappingFailure): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[source-adapters] mapping failure: ${failure.source}[${failure.index}] ` +
      `${failure.name ? `"${failure.name}" ` : ""}— ${failure.reason}`,
  );
}

/** Assemble a versioned snapshot from merged items. */
export function buildSnapshot(
  items: Item[],
  sources: SourceId[],
  revision: number,
  generatedAt: string = new Date().toISOString(),
): ValueSnapshot {
  return {
    schemaVersion: 1,
    revision,
    generatedAt,
    sources,
    items,
  };
}

export * from "./providers.js";
export * from "./audit.js";
export * from "./assets.js";
export * from "./licenses.js";
