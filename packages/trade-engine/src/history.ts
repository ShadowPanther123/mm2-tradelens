import type { SourceId } from "@tradelens/item-schema";
import { BIG_BAND, type TradeResult, type TradeVerdict, type ValuedLine } from "./fairness.js";
import type { Confidence, SourceMode } from "./values.js";

/**
 * A frozen, storable snapshot of a trade calculation.
 *
 * Saved trades must stay interpretable forever, even after item values, the
 * blending algorithm, or the verdict thresholds change. `TradeResult` holds
 * live objects (including nested `ResolvedValue`s); this module captures the
 * exact readings, resolved values, warnings and thresholds that were in force
 * at the moment the trade was evaluated, as plain JSON-serialisable data.
 */

/** One per-source reading, exactly as used at calculation time. */
export interface FrozenReading {
  source: SourceId;
  value: number;
}

/** A single item's frozen valuation on one side of the trade. */
export interface FrozenLine {
  itemId: string;
  displayName: string;
  quantity: number;
  /** Resolved per-unit value that was used. */
  unitValue: number;
  /** unitValue × quantity. */
  lineValue: number;
  /** Exact per-source readings behind the resolved value. */
  readings: FrozenReading[];
  /** Largest relative gap between sources, 0–1. */
  disagreement: number;
  /** Confidence in the resolved value. */
  confidence: Confidence;
  /** True when no value was available under the selected source. */
  unvalued: boolean;
}

/** The verdict thresholds in force when the trade was evaluated. */
export interface FrozenThresholds {
  /** Half-width of the "fair" band, as a ratio distance from parity. */
  fairBand: number;
  /** Fixed "big win/loss" threshold. */
  bigBand: number;
}

/** A warning exactly as it was shown to the user at calculation time. */
export interface FrozenWarning {
  kind: string;
  message: string;
}

/**
 * A complete, self-contained record of a trade calculation. Everything needed
 * to re-display the original verdict is here, so the History view never has to
 * (and never should) recompute against current values.
 */
export interface TradeCalculation {
  algorithmVersion: number;
  mode: SourceMode;
  gave: FrozenLine[];
  received: FrozenLine[];
  yourTotal: number;
  theirTotal: number;
  ratio: number;
  difference: number;
  differencePercent: number;
  rawVerdict: TradeVerdict;
  adjustedVerdict: TradeVerdict;
  confidence: Confidence;
  thresholds: FrozenThresholds;
  warnings: FrozenWarning[];
  /** Plain-language explanation shown at the time. */
  explanation: string;
}

function freezeLine(line: ValuedLine): FrozenLine {
  return {
    itemId: line.id,
    displayName: line.displayName,
    quantity: line.quantity,
    unitValue: line.unitValue,
    lineValue: line.lineValue,
    readings: (line.resolved?.readings ?? []).map((r) => ({ source: r.source, value: r.value })),
    disagreement: line.resolved?.disagreement ?? 0,
    confidence: line.resolved?.confidence ?? "low",
    unvalued: !line.resolved,
  };
}

/**
 * Capture a live {@link TradeResult} as a frozen, JSON-serialisable
 * {@link TradeCalculation} suitable for long-term storage in trade history.
 */
export function toTradeCalculation(result: TradeResult): TradeCalculation {
  return {
    algorithmVersion: result.algorithmVersion,
    mode: result.mode,
    gave: result.your.lines.map(freezeLine),
    received: result.their.lines.map(freezeLine),
    yourTotal: result.your.total,
    theirTotal: result.their.total,
    ratio: result.ratio,
    difference: result.difference,
    differencePercent: result.differencePercent,
    rawVerdict: result.rawVerdict,
    adjustedVerdict: result.adjustedVerdict,
    confidence: result.confidence,
    thresholds: { fairBand: result.fairBand, bigBand: BIG_BAND },
    warnings: result.warnings.map((w) => ({ kind: w.kind, message: w.message })),
    explanation: result.explanation,
  };
}
