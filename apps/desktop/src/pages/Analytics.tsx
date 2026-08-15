import { useEffect, useMemo, useState } from "react";
import {
  historyMovers,
  mergeHistoryReadings,
  resolveValue,
  snapshotHistory,
  type HistoryMover,
  type HistoryReading,
} from "@tradelens/trade-engine";
import { ItemRow, StatPill } from "@/components";
import { useDataStore } from "@/hooks/useDataStore";
import { getAllValueHistory } from "@/database";
import { logger } from "@/services/logger";
import type { Item, SourceId } from "@/types";
import { formatPercent, formatValue } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";

function Ranking({ title, entries }: { title: string; entries: HistoryMover[] }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <div className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          <div
            key={entry.item.id}
            className="glass-soft flex items-center gap-3 rounded-xl px-3 py-2.5"
          >
            <span className="w-5 text-xs text-slate-600">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {entry.item.displayName}
            </span>
            <span className={entry.changePercent >= 0 ? "text-win" : "text-loss"}>
              {formatPercent(entry.changePercent)}
            </span>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-500">
            No movement recorded yet.
          </p>
        )}
      </div>
    </section>
  );
}

export function Analytics() {
  const items = useDataStore((state) => state.items);
  const mode = useDataStore((state) => state.settings.sourceMode);
  const searchStats = useDataStore((state) => state.searchStats);
  const revision = useDataStore((state) => state.snapshotMeta?.revision ?? 0);

  const source: SourceId = (() => {
    const preferred = toEngineMode(mode);
    if (preferred !== "consensus" && items.some((item) => item.values[preferred]))
      return preferred;
    return items.some((item) => item.values.mm2values) ? "mm2values" : "supreme";
  })();

  // Load locally recorded history and merge it with the series embedded in the
  // snapshot so movers reflect real movement even when the newest sync carried
  // no changes on this exact revision.
  const [dbHistory, setDbHistory] = useState<Map<string, HistoryReading[]>>(new Map());
  useEffect(() => {
    let active = true;
    getAllValueHistory()
      .then((rows) => {
        if (!active) return;
        const grouped = new Map<string, HistoryReading[]>();
        for (const p of rows) {
          const reading: HistoryReading = {
            source: p.source,
            value: p.value,
            revision: p.revision,
            recordedAt: p.recordedAt,
          };
          const bucket = grouped.get(p.itemId);
          if (bucket) bucket.push(reading);
          else grouped.set(p.itemId, [reading]);
        }
        setDbHistory(grouped);
      })
      .catch((err) => {
        logger.warn("analytics", "could not load value history", { detail: String(err) });
        if (active) setDbHistory(new Map());
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const history = useMemo(() => {
    const merged = snapshotHistory(items, source);
    for (const item of items) {
      const embedded = merged.get(item.id) ?? [];
      const local = (dbHistory.get(item.id) ?? []).filter((r) => r.source === source);
      const combined = mergeHistoryReadings(embedded, local);
      if (combined.length > 0) merged.set(item.id, combined);
    }
    return merged;
  }, [items, dbHistory, source]);

  const latestMovers = useMemo(
    () => historyMovers(items, history, source, { direction: "both", limit: 100 }),
    [items, history, source],
  );
  const rises = latestMovers.filter((entry) => entry.changePercent > 0).slice(0, 8);
  const falls = latestMovers.filter((entry) => entry.changePercent < 0).slice(0, 8);
  const hottest = useMemo(() => {
    return [...items]
      .map((item) => {
        const reading = item.values[source];
        const mover = latestMovers.find((m) => m.item.id === item.id);
        const movement = Math.abs(mover?.changePercent ?? 0);
        const demand = reading?.demand ?? 0;
        return { item, score: demand * 2 + movement };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [items, source, latestMovers]);
  const searched = searchStats
    .map((stat) => ({ stat, item: items.find((item) => item.id === stat.itemId) }))
    .filter((entry): entry is { stat: typeof entry.stat; item: Item } =>
      Boolean(entry.item),
    )
    .slice(0, 8);
  const totalMarketValue = items.reduce(
    (sum, item) => sum + (resolveValue(item, toEngineMode(mode))?.value ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-slate-500">
          Demand, movement, and local search interest at a glance.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <StatPill label="Items analyzed" value={String(items.length)} />
        </div>
        <div className="card p-4">
          <StatPill label="Market value" value={formatValue(totalMarketValue)} />
        </div>
        <div className="card p-4">
          <StatPill
            label="Searches tracked"
            value={String(searchStats.reduce((sum, stat) => sum + stat.count, 0))}
          />
        </div>
      </div>
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Hottest items</h2>
        <div className="flex flex-col gap-2">
          {hottest.map(({ item, score }) => (
            <ItemRow
              key={item.id}
              item={item}
              mode={mode}
              valueDetail={
                <span
                  className="chip shrink-0 whitespace-nowrap bg-accent/10 text-accent"
                  data-testid="analytics-heat-score"
                >
                  Heat {score.toFixed(1)}
                </span>
              }
            />
          ))}
          {hottest.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">
              No item signals changed in the newest sync.
            </p>
          )}
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Ranking title="Biggest rises" entries={rises} />
        <Ranking title="Biggest falls" entries={falls} />
      </div>
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Most searched</h2>
        <div className="flex flex-col gap-2">
          {searched.map(({ item, stat }, index) => (
            <div
              key={item.id}
              className="glass-soft flex items-center gap-3 rounded-xl px-3 py-2.5"
            >
              <span className="w-5 text-xs text-slate-600">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {item.displayName}
              </span>
              <span className="text-xs text-slate-400">
                {stat.count} search{stat.count === 1 ? "" : "es"}
              </span>
            </div>
          ))}
          {searched.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">
              Search selections will build this ranking.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
