import { z } from "zod";

/**
 * MM2 TradeLens shared item schema.
 *
 * These schemas define the single, canonical shape every value source is
 * normalised into. Runtime validation (via zod) is used at data boundaries:
 * when importing a source snapshot, when loading cached data, and in tests.
 */

/** Broad item category. */
export const ItemCategory = z.enum([
  "knife",
  "gun",
  "pet",
  "bundle",
  "other",
]);
export type ItemCategory = z.infer<typeof ItemCategory>;

/**
 * Community rarity tier.
 *
 * `pet` and `misc` are catch-all buckets for source rows that are grouped by
 * category rather than a weapon rarity (pets and miscellaneous items such as
 * boxes), so their real classification is preserved instead of being forced
 * into an unrelated rarity.
 */
export const ItemRarity = z.enum([
  "common",
  "uncommon",
  "rare",
  "legendary",
  "godly",
  "ancient",
  "unique",
  "vintage",
  "chroma",
  "pet",
  "misc",
]);
export type ItemRarity = z.infer<typeof ItemRarity>;

/** How steady a value has been recently. */
export const Stability = z.enum(["stable", "fluctuating", "volatile"]);
export type Stability = z.infer<typeof Stability>;

/** Identifier of a supported value source. */
export const SourceId = z.enum(["supreme", "mm2values", "community"]);
export type SourceId = z.infer<typeof SourceId>;

/** How a source reading was obtained (for provenance and auditing). */
export const ExtractionMethod = z.enum([
  "api",
  "partner-feed",
  "licensed-export",
  "manual-entry",
]);
export type ExtractionMethod = z.infer<typeof ExtractionMethod>;

/** A single source's reading for one item. */
export const SourceValue = z.object({
  /** Headline value in the game's trading unit. */
  value: z.number().nonnegative(),
  /** Demand rating, 0–5 (calibrated for the trade calculator). */
  demand: z.number().min(0).max(5).optional(),
  /** Rarity/desirability score, 0–5 (calibrated for the trade calculator). */
  rarityScore: z.number().min(0).max(5).optional(),
  /** Raw source demand rating on the source's own 0–11 scale, for display. */
  demandRating: z.number().min(0).max(11).optional(),
  /** Raw source rarity rating on the source's own 0–11 scale, for display. */
  rarityRating: z.number().min(0).max(11).optional(),
  /** Published value range (low–high), where the source reports one. */
  valueRange: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .optional(),
  /** Recent price stability, bucketed to the calculator's enum. */
  stability: Stability.optional(),
  /** Exact stability label as published by the source (e.g. "Overpaid For"). */
  stabilityLabel: z.string().max(64).optional(),
  /** Percentage trend over the source's recent window. */
  trendPercent: z.number().optional(),
  /** Previous value, used to compute change deltas. */
  previousValue: z.number().nonnegative().optional(),
  /** When the source itself last updated this reading (ISO 8601). */
  updatedAt: z.string().datetime(),
  /** When TradeLens imported this reading (ISO 8601). */
  importedAt: z.string().datetime().optional(),
  /** When TradeLens retrieved this reading from the source (ISO 8601). */
  retrievedAt: z.string().datetime().optional(),
  /** The identifier this reading has in the source's own system, if any. */
  sourceItemId: z.string().optional(),
  /** Original source page/record URL, stored only where the source permits it. */
  sourceUrl: z.string().url().optional(),
  /** Version of the adapter that produced this reading. */
  adapterVersion: z.string().optional(),
  /** How the reading was obtained. */
  extractionMethod: ExtractionMethod.optional(),
  /** Validation status assigned during import. */
  validation: z.enum(["ok", "suspect", "stale"]).optional(),
  /** Manual-review status of this reading, set by an administrator. */
  reviewStatus: z.enum(["unreviewed", "approved", "rejected"]).optional(),
});
export type SourceValue = z.infer<typeof SourceValue>;

/**
 * A single manual correction applied to an item, forming an audit trail so
 * every hand-edit is attributable and reversible.
 */
export const Correction = z.object({
  /** When the correction was made (ISO 8601). */
  at: z.string().datetime(),
  /** Who made the correction (operator id, email or name). */
  by: z.string().min(1),
  /** The field that was changed, e.g. "rarity" or "values.supreme.value". */
  field: z.string().min(1),
  /** Previous value, serialised for display. */
  from: z.string().optional(),
  /** New value, serialised for display. */
  to: z.string().optional(),
  /** Optional free-text reason for the change. */
  note: z.string().optional(),
});
export type Correction = z.infer<typeof Correction>;

/** A canonical MM2 item with values from every known source. */
export const Item = z.object({
  /** Stable internal identifier (slug), e.g. "icepiercer". */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "id must be a lowercase slug"),
  displayName: z.string().min(1),
  /** Alternate spellings and abbreviations used by search. */
  aliases: z.array(z.string()).default([]),
  category: ItemCategory,
  rarity: ItemRarity,
  /** Human-readable origin, e.g. "Christmas 2022". */
  origin: z.string().optional(),
  /** Release year, used for search and filtering. */
  year: z.number().int().optional(),
  /** Whether this is a chroma variant. */
  chroma: z.boolean().default(false),
  /** Image filename or URL. */
  image: z.string().optional(),
  /**
   * Whether every reading on this item comes from a trusted, permitted source.
   * False marks records that were entered or edited manually and still need
   * confirmation against a trusted source.
   */
  verified: z.boolean().default(true),
  /** Where this item sits in the manual-review workflow. */
  reviewStatus: z.enum(["unreviewed", "in-review", "approved", "rejected"]).optional(),
  /** Audit trail of manual corrections applied to this item. */
  corrections: z.array(Correction).optional(),
  /** Per-source readings, keyed by source id. */
  values: z.record(SourceId, SourceValue),
});
export type Item = z.infer<typeof Item>;

/** A signed, versioned snapshot the desktop app downloads and caches offline. */
export const ValueSnapshot = z.object({
  /** Snapshot schema version. */
  schemaVersion: z.literal(1),
  /** Monotonic snapshot revision. */
  revision: z.number().int().nonnegative(),
  /** When this snapshot was generated (ISO 8601). */
  generatedAt: z.string().datetime(),
  /** Which sources contributed to this snapshot. */
  sources: z.array(SourceId),
  items: z.array(Item),
});
export type ValueSnapshot = z.infer<typeof ValueSnapshot>;

/** Parse and validate an unknown value as an Item, throwing on failure. */
export function parseItem(input: unknown): Item {
  return Item.parse(input);
}

/** Parse and validate an unknown value as a ValueSnapshot, throwing on failure. */
export function parseSnapshot(input: unknown): ValueSnapshot {
  return ValueSnapshot.parse(input);
}

/** Safe parse helper returning a discriminated result. */
export function safeParseSnapshot(input: unknown) {
  return ValueSnapshot.safeParse(input);
}

/** The highest snapshot schema version this build understands. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/**
 * Detached signature envelope for a snapshot. The signature covers the
 * canonical JSON of the `snapshot` field only, so the envelope can carry extra
 * transport metadata without invalidating the signature.
 */
export const SignedSnapshot = z.object({
  /** Signing algorithm — only Ed25519 is accepted. */
  algorithm: z.literal("ed25519"),
  /** Identifier of the key pair used, so keys can be rotated. */
  keyId: z.string().min(1),
  /** Base64-encoded Ed25519 signature over the canonical snapshot bytes. */
  signature: z.string().min(1),
  /** The signed snapshot payload. */
  snapshot: ValueSnapshot,
});
export type SignedSnapshot = z.infer<typeof SignedSnapshot>;

/** Parse and validate an unknown value as a SignedSnapshot, throwing on failure. */
export function parseSignedSnapshot(input: unknown): SignedSnapshot {
  return SignedSnapshot.parse(input);
}

/** Safe parse helper for a signed snapshot envelope. */
export function safeParseSignedSnapshot(input: unknown) {
  return SignedSnapshot.safeParse(input);
}

/**
 * Deterministic serialisation of a snapshot for signing and checksums.
 *
 * Object keys are emitted in a stable, recursively-sorted order so the exact
 * same bytes are produced on the signer and the verifier regardless of how the
 * object was constructed.
 */
export function canonicaliseSnapshot(snapshot: ValueSnapshot): string {
  return stableStringify(snapshot);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}
