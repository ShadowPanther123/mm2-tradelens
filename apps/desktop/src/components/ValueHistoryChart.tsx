import { useEffect, useState } from "react";
import type { HistoryPoint } from "@/types";
import { getValueHistory } from "@/database";
import { formatValue } from "@/utils/format";
import { logger } from "@/services/logger";
import { Sparkline } from "./Sparkline";
import { StatPill } from "./StatPill";

interface ValueHistoryChartProps {
  itemId: string;
  /** Which source's readings to chart. Defaults to the consensus of all sources. */
  source?: string;
}

/**
 * Price history for one item, drawn from the locally recorded value-history
 * time series. Each recorded snapshot revision contributes one point, so the
 * line shows how the item's value has moved over time. Renders nothing until at
 * least two readings exist, keeping the view calm for brand-new items.
 */
export function ValueHistoryChart({ itemId, source }: ValueHistoryChartProps) {
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);

  useEffect(() => {
    let active = true;
    setPoints(null);
    getValueHistory(itemId)
      .then((rows) => {
        if (active) setPoints(rows);
      })
      .catch((err) => {
        if (active) setPoints([]);
        logger.warn("history", "could not load value history", { itemId, detail: String(err) });
      });
    return () => {
      active = false;
    };
  }, [itemId]);

  if (points === null) return null;

  // Collapse each revision to a single value: the chosen source, or the average
  // across sources when none is specified.
  const byRevision = new Map<number, { sum: number; count: number; recordedAt: string }>();
  for (const p of points) {
    if (source && p.source !== source) continue;
    const entry = byRevision.get(p.revision);
    if (entry) {
      entry.sum += p.value;
      entry.count += 1;
    } else {
      byRevision.set(p.revision, { sum: p.value, count: 1, recordedAt: p.recordedAt });
    }
  }

  const series = [...byRevision.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v.sum / v.count);

  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const latest = series[series.length - 1];

  return (
    <div className="card flex flex-col gap-3 p-5">
      <h2 className="text-sm font-semibold text-slate-300">Price history</h2>
      <Sparkline points={series} width={280} height={64} className="w-full" />
      <div className="grid grid-cols-3 gap-4 text-sm">
        <StatPill label="Low" value={formatValue(min)} />
        <StatPill label="High" value={formatValue(max)} />
        <StatPill label="Latest" value={formatValue(latest)} />
      </div>
    </div>
  );
}
