import { resolveValue } from "@tradelens/trade-engine";
import type { Item, SourceMode } from "@/types";
import { formatValue } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";
import { cn } from "@/utils/cn";

const CONFIDENCE_STYLES = {
  high: "bg-win/15 text-win",
  medium: "bg-warn/15 text-warn",
  low: "bg-loss/15 text-loss",
} as const;

/** Resolved value figure with a confidence chip and optional staleness dot. */
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
  return (
    <div className="flex items-center gap-2">
      <span className={cn("font-semibold tabular-nums", large ? "text-2xl" : "text-sm")}>
        {formatValue(resolved.value)}
      </span>
      <span className={cn("chip", CONFIDENCE_STYLES[resolved.confidence])}>
        {resolved.confidence}
      </span>
      {resolved.stale && (
        <span className="chip bg-warn/15 text-warn" title="Value is over 48h old">
          stale
        </span>
      )}
    </div>
  );
}
