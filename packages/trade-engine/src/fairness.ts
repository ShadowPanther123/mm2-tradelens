import type { Item } from "@tradelens/item-schema";
import {
  resolveValue,
  roundValue,
  type Confidence,
  type ResolvedValue,
  type SourceMode,
} from "./values.js";

/**
 * Version of the trade-evaluation algorithm.
 *
 * Bump this whenever the value blending, verdict thresholds, demand adjustment,
 * or warning logic change in a way that could alter a result. It is recorded
 * alongside saved trades so a historical verdict can always be understood in
 * terms of the rules that produced it, even after the algorithm evolves.
 */
export const ALGORITHM_VERSION = 1 as const;

/** One stack of a single item on a side of the trade. */
export interface TradeLine {
  item: Item;
  quantity: number;
}

/** Outcome label for a trade. */
export type TradeVerdict =
  | "big-win"
  | "win"
  | "fair"
  | "loss"
  | "big-loss"
  | "unknown";

/** A per-line valuation used in the breakdown. */
export interface ValuedLine {
  id: string;
  displayName: string;
  quantity: number;
  unitValue: number;
  lineValue: number;
  resolved?: ResolvedValue;
}

/** Aggregate of one side of the trade. */
export interface SideTotal {
  lines: ValuedLine[];
  total: number;
  /** Demand-weighted total used for the adjusted verdict. */
  adjustedTotal: number;
  /** Whether any line could not be valued under the current mode. */
  hasUnvalued: boolean;
}

/** A non-fatal caution surfaced to the user. */
export interface TradeWarning {
  kind:
    | "source-disagreement"
    | "stability"
    | "stale-data"
    | "collectible"
    | "duplicate"
    | "same-item-both-sides"
    | "low-confidence"
    | "missing-values";
  message: string;
}

/** Full result of evaluating a two-sided trade. */
export interface TradeResult {
  /** Version of the algorithm that produced this result. */
  algorithmVersion: number;
  mode: SourceMode;
  your: SideTotal;
  their: SideTotal;
  /** their.total / your.total. */
  ratio: number;
  /** their.total - your.total (what you gain, if positive). */
  difference: number;
  differencePercent: number;
  rawVerdict: TradeVerdict;
  /** Verdict after applying demand adjustment. */
  adjustedVerdict: TradeVerdict;
  /** Half-width of the "fair" band as a ratio distance from 1.0. */
  fairBand: number;
  confidence: Confidence;
  /** True when any item on either side has no value under the current source. */
  hasMissingValues: boolean;
  warnings: TradeWarning[];
  /** Plain-language explanation of the adjusted verdict. */
  explanation: string;
}

/**
 * Exact verdict thresholds, expressed as the received/given value ratio.
 *
 *   ratio ≥ 1.15                    → Big Win
 *   1 + fairBand ≤ ratio < 1.15     → Win
 *   1 − fairBand < ratio < 1 + fairBand → Fair
 *   1 − 0.15 < ratio ≤ 1 − fairBand → Loss
 *   ratio ≤ 0.85                    → Big Loss
 *
 * `fairBand` starts at ±5% of parity and widens automatically when the sources
 * disagree or an item is unstable, so a genuinely borderline trade is reported
 * as fair rather than nudging the user toward a decision. The "big" thresholds
 * are fixed at ±15% and are not widened.
 */
/** Default fair band: ratios within ±5% of 1.0 are "fair". */
export const BASE_FAIR_BAND = 0.05;
/** "Big" thresholds sit at ±15% of 1.0. */
export const BIG_BAND = 0.15;

/**
 * Demand acts as a gentle multiplier around 1.0. A demand of 2.5/5 is neutral;
 * higher demand makes an item worth slightly more in practice, lower demand
 * slightly less. Bounded so it never dominates the raw value.
 */
function demandMultiplier(demand: number | undefined): number {
  if (demand === undefined) return 1;
  const neutral = 2.5;
  const perPoint = 0.06; // up to ±15% at the extremes
  return 1 + (demand - neutral) * perPoint;
}

function valueSide(lines: TradeLine[], mode: SourceMode, now: number): SideTotal {
  const valued: ValuedLine[] = [];
  let total = 0;
  let adjustedTotal = 0;
  let hasUnvalued = false;

  for (const line of lines) {
    const resolved = resolveValue(line.item, mode, now);
    const unitValue = resolved?.value ?? 0;
    const lineValue = unitValue * line.quantity;
    if (!resolved) hasUnvalued = true;
    total += lineValue;
    adjustedTotal += lineValue * demandMultiplier(resolved?.demand);
    valued.push({
      id: line.item.id,
      displayName: line.item.displayName,
      quantity: line.quantity,
      unitValue,
      lineValue,
      resolved,
    });
  }

  return { lines: valued, total, adjustedTotal, hasUnvalued };
}

function verdictFromRatio(ratio: number, fairBand: number): TradeVerdict {
  if (Number.isNaN(ratio)) return "unknown";
  // Receiving something for nothing is an unbounded win; giving something for
  // nothing is an unbounded loss.
  if (ratio === Number.POSITIVE_INFINITY) return "big-win";
  if (ratio >= 1 + BIG_BAND) return "big-win";
  if (ratio >= 1 + fairBand) return "win";
  if (ratio > 1 - fairBand) return "fair";
  if (ratio > 1 - BIG_BAND) return "loss";
  return "big-loss";
}

const RARE_RARITIES = new Set(["ancient", "unique", "vintage", "chroma"]);

function collectWarnings(
  your: SideTotal,
  their: SideTotal,
  lines: { your: TradeLine[]; their: TradeLine[] },
  confidence: Confidence,
): TradeWarning[] {
  const warnings: TradeWarning[] = [];
  const allResolved = [...your.lines, ...their.lines]
    .map((l) => l.resolved)
    .filter((r): r is ResolvedValue => Boolean(r));

  const maxDisagreement = allResolved.reduce(
    (m, r) => Math.max(m, r.disagreement),
    0,
  );
  if (maxDisagreement > 0.06) {
    warnings.push({
      kind: "source-disagreement",
      message: `Sources disagree by up to ${(maxDisagreement * 100).toFixed(1)}% on at least one item. The fair range has been widened.`,
    });
  }

  if (allResolved.some((r) => r.stability === "volatile" || r.stability === "fluctuating")) {
    warnings.push({
      kind: "stability",
      message:
        "At least one item's value is currently moving. Treat this result as a guide, not a guarantee.",
    });
  }

  if (allResolved.some((r) => r.stale)) {
    warnings.push({
      kind: "stale-data",
      message:
        "Some values are more than 48 hours old. Consider confirming important trades with another source.",
    });
  }

  // Missing values: an item on either side has no reading under the current
  // source. It is counted as 0, but that is surfaced clearly here — never
  // silently — and it drags confidence down (see deriveResultConfidence).
  if (your.hasUnvalued || their.hasUnvalued) {
    warnings.push({
      kind: "missing-values",
      message:
        "One or more items have no value under the selected source, so this comparison is incomplete. They were counted as 0 — not as a real price.",
    });
  }

  if (confidence === "low") {
    warnings.push({
      kind: "low-confidence",
      message:
        "Confidence in this result is low. The underlying values are uncertain, so treat it as a rough guide only.",
    });
  }

  const rareItems = [...lines.your, ...lines.their].filter((l) =>
    RARE_RARITIES.has(l.item.rarity),
  );
  if (rareItems.length > 0) {
    warnings.push({
      kind: "collectible",
      message: `Includes collectible/rare items (${rareItems
        .map((l) => l.item.displayName)
        .join(", ")}). These are easily manipulated and their real-world worth can differ from list values.`,
    });
  }

  // The same item on both sides usually cancels out, but flag it because it is
  // often a mistake or a padding tactic.
  const yourIds = new Set(lines.your.map((l) => l.item.id));
  const onBoth = lines.their.filter((l) => yourIds.has(l.item.id));
  if (onBoth.length > 0) {
    warnings.push({
      kind: "same-item-both-sides",
      message: `The same item appears on both sides (${onBoth
        .map((l) => l.item.displayName)
        .join(", ")}). Check this is intended — it doesn't change hands.`,
    });
  }

  const dupes = [...lines.your, ...lines.their].filter((l) => l.quantity > 1);
  if (dupes.length > 0) {
    warnings.push({
      kind: "duplicate",
      message: `Multiple copies included (${dupes
        .map((l) => `${l.item.displayName} ×${l.quantity}`)
        .join(", ")}). Duplicates often trade below single-item value.`,
    });
  }

  return warnings;
}

function worstConfidence(sides: SideTotal[]): Confidence {
  const ranks: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  let worst: Confidence = "high";
  for (const side of sides) {
    for (const line of side.lines) {
      const c = line.resolved?.confidence ?? "low";
      if (ranks[c] < ranks[worst]) worst = c;
    }
  }
  return worst;
}

function verdictLabel(v: TradeVerdict): string {
  switch (v) {
    case "big-win":
      return "Big Win";
    case "win":
      return "Win";
    case "fair":
      return "Fair Trade";
    case "loss":
      return "Loss";
    case "big-loss":
      return "Big Loss";
    default:
      return "Unknown";
  }
}

/**
 * Evaluate a two-sided trade.
 *
 * "your" is what you give; "their" is what you receive. Results are framed as
 * gentle guidance: the fair band widens automatically when sources disagree or
 * items are unstable, so a genuinely borderline trade is reported as fair
 * rather than nudging the user toward a decision.
 */
export function evaluateTrade(
  your: TradeLine[],
  their: TradeLine[],
  mode: SourceMode = "consensus",
  now: number = Date.now(),
): TradeResult {
  const yourSide = valueSide(your, mode, now);
  const theirSide = valueSide(their, mode, now);

  const ratio =
    yourSide.total === 0
      ? theirSide.total === 0
        ? 1
        : Number.POSITIVE_INFINITY
      : theirSide.total / yourSide.total;
  const adjustedRatio =
    yourSide.adjustedTotal === 0
      ? theirSide.adjustedTotal === 0
        ? 1
        : Number.POSITIVE_INFINITY
      : theirSide.adjustedTotal / yourSide.adjustedTotal;

  const difference = theirSide.total - yourSide.total;
  const differencePercent =
    yourSide.total === 0 ? 0 : (difference / yourSide.total) * 100;

  // Widen the fair band when the trade is uncertain.
  const allResolved = [...yourSide.lines, ...theirSide.lines]
    .map((l) => l.resolved)
    .filter((r): r is ResolvedValue => Boolean(r));
  const maxDisagreement = allResolved.reduce(
    (m, r) => Math.max(m, r.disagreement),
    0,
  );
  const unstable = allResolved.some(
    (r) => r.stability === "volatile" || r.stability === "fluctuating",
  );
  const fairBand =
    BASE_FAIR_BAND + maxDisagreement * 0.5 + (unstable ? 0.03 : 0);

  const rawVerdict = verdictFromRatio(ratio, fairBand);
  const adjustedVerdict = verdictFromRatio(adjustedRatio, fairBand);
  const confidence = worstConfidence([yourSide, theirSide]);
  const hasMissingValues = yourSide.hasUnvalued || theirSide.hasUnvalued;

  const warnings = collectWarnings(yourSide, theirSide, { your, their }, confidence);

  const explanation = buildExplanation(
    rawVerdict,
    adjustedVerdict,
    differencePercent,
    yourSide,
    theirSide,
  );

  return {
    algorithmVersion: ALGORITHM_VERSION,
    mode,
    your: yourSide,
    their: theirSide,
    ratio,
    difference: roundValue(difference),
    differencePercent,
    rawVerdict,
    adjustedVerdict,
    fairBand,
    confidence,
    hasMissingValues,
    warnings,
    explanation,
  };
}

function buildExplanation(
  raw: TradeVerdict,
  adjusted: TradeVerdict,
  diffPct: number,
  your: SideTotal,
  their: SideTotal,
): string {
  if (raw === "unknown") {
    return "There isn't enough value information to judge this trade yet.";
  }
  if (your.total === 0 && their.total > 0) {
    return `${verdictLabel(raw)}. You'd receive items without giving anything.`;
  }
  if (their.total === 0 && your.total > 0) {
    return `${verdictLabel(raw)}. You'd give items without receiving anything.`;
  }
  const dir =
    diffPct > 0.5
      ? `Their side is ${diffPct.toFixed(1)}% higher.`
      : diffPct < -0.5
        ? `Your side is ${Math.abs(diffPct).toFixed(1)}% higher.`
        : "Both sides are within a whisker of each other.";

  if (raw === adjusted) {
    return `${verdictLabel(raw)}. ${dir}`;
  }

  const yourDemand = averageDemand(your);
  const theirDemand = averageDemand(their);
  const demandNote =
    theirDemand !== undefined && yourDemand !== undefined
      ? theirDemand < yourDemand
        ? "The items you receive have lower demand, so the practical result is softer than the raw numbers suggest."
        : "The items you receive have higher demand, which improves the practical result."
      : "Demand differences shift the practical result.";

  return `Raw: ${verdictLabel(raw)}. ${dir} Demand-adjusted: ${verdictLabel(
    adjusted,
  )}. ${demandNote}`;
}

function averageDemand(side: SideTotal): number | undefined {
  const demands = side.lines
    .map((l) => l.resolved?.demand)
    .filter((d): d is number => typeof d === "number");
  if (demands.length === 0) return undefined;
  return demands.reduce((a, b) => a + b, 0) / demands.length;
}

export { verdictLabel };
