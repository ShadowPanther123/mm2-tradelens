import { useEffect, useMemo, useState } from "react";
import type { HistoryPoint, Item } from "@/types";
import { getValueHistory } from "@/database";
import { formatPercent, formatValue } from "@/utils/format";
import { logger } from "@/services/logger";
import { Sparkline } from "./Sparkline";
import { StatPill } from "./StatPill";
import {
  buildItemHistory,
  historyForWindow,
  type HistoryWindow,
} from "@/utils/valueHistory";

interface ValueHistoryChartProps {
  item: Item;
  /** Which source's readings to chart. Defaults to the consensus of all sources. */
  source?: string;
}

const WINDOWS: HistoryWindow[] = [7, 30, 90];

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

/** Price history for one item with 7, 30 and 90-day views. */
export function ValueHistoryChart({ item, source }: ValueHistoryChartProps) {
  const [local, setLocal] = useState<HistoryPoint[]>([]);
  const [days, setDays] = useState<HistoryWindow>(30);

  useEffect(() => {
    let active = true;
    getValueHistory(item.id)
      .then((rows) => {
        if (active) setLocal(rows);
      })
      .catch((err) => {
        if (active) setLocal([]);
        logger.warn("history", "could not load value history", {
          itemId: item.id,
          detail: String(err),
        });
      });
    return () => {
      active = false;
    };
  }, [item.id]);

  const allPoints = useMemo(
    () => buildItemHistory(item, local, source),
    [item, local, source],
  );
  const points = useMemo(() => historyForWindow(allPoints, days), [allPoints, days]);
  const series = points.map((point) => point.value);
  const min = series.length > 0 ? Math.min(...series) : 0;
  const max = series.length > 0 ? Math.max(...series) : 0;
  const latest = series.at(-1) ?? 0;
  const first = series[0] ?? 0;
  const change = first > 0 ? ((latest - first) / first) * 100 : 0;

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Value history</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {source ?? "Combined sources"} · {points.length} reading
            {points.length === 1 ? "" : "s"}
          </p>
        </div>
        <div
          className="flex rounded-xl bg-white/5 p-0.5"
          role="group"
          aria-label="History range"
        >
          {WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              onClick={() => setDays(window)}
              aria-pressed={days === window}
              className={
                "rounded-lg px-3 py-1 text-xs transition " +
                (days === window
                  ? "bg-accent/20 text-accent"
                  : "text-slate-400 hover:text-slate-200")
              }
            >
              {window}D
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-black/10 px-2 py-3">
        {series.length > 0 ? (
          <>
            <Sparkline points={series} width={640} height={112} className="w-full" />
            <div className="mt-1 flex justify-between px-1 text-[10px] text-slate-500">
              <span>{shortDate(points[0]!.recordedAt)}</span>
              <span>{shortDate(points.at(-1)!.recordedAt)}</span>
            </div>
          </>
        ) : (
          <div className="flex h-28 items-center justify-center text-xs text-slate-500">
            History will appear after the next value update.
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 text-sm">
        <StatPill label={`${days}D change`} value={formatPercent(change)} />
        <StatPill label="Low" value={series.length ? formatValue(min) : "—"} />
        <StatPill label="High" value={series.length ? formatValue(max) : "—"} />
        <StatPill label="Latest" value={series.length ? formatValue(latest) : "—"} />
      </div>
    </div>
  );
}
