import { resolveValue } from "@tradelens/trade-engine";
import type { Item, SourceMode } from "@/types";
import { capitalise, formatRating, formatValue } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";
import { cn } from "@/utils/cn";

const STABILITY_STYLES = {
  stable: "bg-win/15 text-win",
  fluctuating: "bg-warn/15 text-warn",
  volatile: "bg-loss/15 text-loss",
} as const;

/**
 * Resolved value figure with the source's own trading signals: Demand and
 * Rarity ratings (0–11), Stability, and the published value Range.
 */
export function ValueBadge({
  item,
  mode,
  large = false,
}: {
  item: Item;
  mode: SourceMode;
  large?: boolean;
}) {
  const resolved = resolveValue(item, toEngineMode(mode));
  if (!resolved) {
    return <span className="text-slate-500">No value</span>;
  }
  const range = resolved.valueRange
    ? `${formatValue(resolved.valueRange.low)}–${formatValue(resolved.valueRange.high)}`
    : "N/A";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <span
        className={cn(
          "font-semibold tabular-nums",
          large ? "text-2xl" : "text-sm",
        )}
      >
        {formatValue(resolved.value)}
      </span>
      {resolved.demandRating !== undefined && (
        <span className="chip bg-slate-500/15 text-slate-300" title="Demand (0–11)">
          Demand {formatRating(resolved.demandRating)}
        </span>
      )}
      {resolved.rarityRating !== undefined && (
        <span className="chip bg-slate-500/15 text-slate-300" title="Rarity (0–11)">
          Rarity {formatRating(resolved.rarityRating)}
        </span>
      )}
      {resolved.stability && (
        <span
          className={cn("chip", STABILITY_STYLES[resolved.stability])}
          title="Recent price stability"
        >
          {capitalise(resolved.stability)}
        </span>
      )}
      <span className="chip bg-slate-500/15 text-slate-400" title="Published value range">
        Range {range}
      </span>
    </div>
  );
}
