import { Link } from "react-router-dom";
import type { TrendEntry } from "@tradelens/trade-engine";
import { formatPercent, formatValue } from "@/utils/format";
import { cn } from "@/utils/cn";

interface TrendBarsProps {
  entries: TrendEntry[];
  className?: string;
}

/**
 * A calm diverging bar chart: each row shows an item's recent movement as a bar
 * growing left (down) or right (up) from a centre line. Bar width is scaled to
 * the largest absolute change in the set so proportions stay readable.
 */
export function TrendBars({ entries, className }: TrendBarsProps) {
  if (entries.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-slate-500">
        Nothing notable is moving right now.
      </p>
    );
  }

  const maxAbs = Math.max(...entries.map((e) => Math.abs(e.changePercent)), 1);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {entries.map((e) => {
        const up = e.changePercent >= 0;
        const widthPct = (Math.abs(e.changePercent) / maxAbs) * 50;
        return (
          <Link
            key={`${e.item.id}-${e.source}`}
            to={`/item/${e.item.id}`}
            className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5"
          >
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {e.item.displayName}
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums text-xs",
                    up ? "text-win" : "text-loss",
                  )}
                >
                  {formatPercent(e.changePercent)}
                </span>
              </div>
              <div className="relative mt-1 h-1.5 w-full rounded-full bg-white/5">
                <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
                <div
                  className={cn(
                    "absolute top-0 h-full rounded-full",
                    up ? "bg-win/60" : "bg-loss/60",
                  )}
                  style={{
                    width: `${widthPct}%`,
                    left: up ? "50%" : `${50 - widthPct}%`,
                  }}
                />
              </div>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {formatValue(e.value)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
