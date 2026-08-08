import type { Item, SourceId, SourceValue } from "@tradelens/item-schema";

/**
 * Value resolution: turning per-source readings into a single figure the
 * trade calculator can use — while never *silently* averaging away real
 * disagreement between sources.
 */

/** Which value figure to use for calculations. */
export type SourceMode = SourceId | "consensus";

/**
 * The internal identifier for the blended figure remains `"consensus"` for
 * storage/wire compatibility, but the user-facing name is "Combined estimate".
 * Use {@link sourceModeLabel} for anything shown to a person.
 */
export const COMBINED_MODE: SourceMode = "consensus";

/** Human-readable label for a source mode. */
export function sourceModeLabel(mode: SourceMode): string {
  switch (mode) {
    case "consensus":
      return "Combined estimate";
    case "supreme":
      return "Supreme Values";
    case "mm2values":
      return "MM2Values";
    case "community":
      return "Community";
    default:
      return mode;
  }
}

/**
 * Rounding rule for values shown to the user.
 *
 * Values are kept at full precision throughout the calculation (so repeated
 * sums never drift), and only rounded at the very end for display. Rounding is
 * "half away from zero" to the nearest whole trading unit — e.g. 2.5 → 3,
 * -2.5 → -3 — which matches how people read these numbers.
 */
export function roundValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Qualitative confidence in a resolved value. */
export type Confidence = "high" | "medium" | "low";

/** A resolved value plus everything needed to explain it to the user. */
export interface ResolvedValue {
  /** The value used for calculations. */
  value: number;
  /** The mode that produced it. */
  mode: SourceMode;
  /** Per-source readings that were available. */
  readings: Array<{ source: SourceId; value: number }>;
  /** Largest relative gap between sources, 0–1 (e.g. 0.054 = 5.4%). */
  disagreement: number;
  /** Confidence derived from disagreement, stability and staleness. */
  confidence: Confidence;
  /** Averaged demand across available sources, if any. */
  demand?: number;
  /** Worst (least steady) stability reported across sources. */
  stability?: SourceValue["stability"];
  /** True when a contributing reading is flagged stale. */
  stale: boolean;
}

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function isStale(reading: SourceValue, now: number): boolean {
  if (reading.validation === "stale") return true;
  const updated = Date.parse(reading.updatedAt);
  if (Number.isNaN(updated)) return false;
  return now - updated > STALE_AFTER_MS;
}

/** Worst-case stability ordering (higher = less steady). */
const STABILITY_RANK: Record<NonNullable<SourceValue["stability"]>, number> = {
  stable: 0,
  fluctuating: 1,
  volatile: 2,
};

function worstStability(
  readings: SourceValue[],
): SourceValue["stability"] | undefined {
  let worst: SourceValue["stability"] | undefined;
  for (const r of readings) {
    if (!r.stability) continue;
    if (worst === undefined || STABILITY_RANK[r.stability] > STABILITY_RANK[worst]) {
      worst = r.stability;
    }
  }
  return worst;
}

/**
 * Relative disagreement across readings: the spread (max - min) divided by the
 * mean. Returns 0 when there is a single reading or the mean is 0.
 */
export function computeDisagreement(values: number[]): number {
  if (values.length < 2) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  return (max - min) / mean;
}

function deriveConfidence(
  disagreement: number,
  stability: SourceValue["stability"] | undefined,
  stale: boolean,
  readingCount: number,
): Confidence {
  if (stale || readingCount === 0) return "low";
  let score = 2; // start at "high"
  if (disagreement > 0.15) score -= 2;
  else if (disagreement > 0.06) score -= 1;
  if (stability === "volatile") score -= 2;
  else if (stability === "fluctuating") score -= 1;
  if (readingCount < 2) score -= 1;
  if (score >= 2) return "high";
  if (score >= 1) return "medium";
  return "low";
}

/**
 * Confidence in a single source's reading, judged on its own merits so each
 * source can be shown with its own trust level. A reading is downgraded when it
 * is stale, flagged during import, or reported as unsteady — otherwise it is
 * treated as high confidence.
 */
export function readingConfidence(
  reading: SourceValue,
  now: number = Date.now(),
): Confidence {
  if (isStale(reading, now) || reading.validation === "stale") return "low";
  let score = 2; // start at "high"
  if (reading.validation === "suspect") score -= 1;
  if (reading.reviewStatus === "rejected") score -= 2;
  if (reading.stability === "volatile") score -= 2;
  else if (reading.stability === "fluctuating") score -= 1;
  if (score >= 2) return "high";
  if (score >= 1) return "medium";
  return "low";
}

/**
 * Resolve an item's value under a given source mode.
 *
 * The "Combined estimate" (internally `"consensus"`) is the arithmetic mean of
 * every available provider reading — nothing is weighted or discarded, so two
 * sources of 100 and 120 combine to exactly 110. The individual readings are
 * always returned in `readings` so the UI can show the underlying provider
 * figures rather than only the blend, and `disagreement`/`confidence` surface
 * how far the sources differ instead of hiding it.
 *
 * The returned `value` is kept at full precision; callers round for display
 * with {@link roundValue}.
 */
export function resolveValue(
  item: Item,
  mode: SourceMode,
  now: number = Date.now(),
): ResolvedValue | undefined {
  const entries = Object.entries(item.values) as Array<[SourceId, SourceValue]>;
  if (entries.length === 0) return undefined;

  const readings = entries.map(([source, v]) => ({ source, value: v.value }));
  const allReadings = entries.map(([, v]) => v);
  const disagreement = computeDisagreement(readings.map((r) => r.value));
  const stale = allReadings.some((r) => isStale(r, now));
  const stability = worstStability(allReadings);

  const demandValues = allReadings
    .map((r) => r.demand)
    .filter((d): d is number => typeof d === "number");
  const demand =
    demandValues.length > 0
      ? demandValues.reduce((a, b) => a + b, 0) / demandValues.length
      : undefined;

  let value: number;
  if (mode === "consensus") {
    value = readings.reduce((a, r) => a + r.value, 0) / readings.length;
  } else {
    const picked = item.values[mode];
    if (!picked) return undefined;
    value = picked.value;
  }

  const confidence = deriveConfidence(
    disagreement,
    stability,
    stale,
    readings.length,
  );

  return {
    value,
    mode,
    readings,
    disagreement,
    confidence,
    demand,
    stability,
    stale,
  };
}
