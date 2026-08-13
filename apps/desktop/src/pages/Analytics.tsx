import { useMemo } from "react";
import { biggestMovers, resolveValue, type TrendEntry } from "@tradelens/trade-engine";
import { ItemRow, StatPill } from "@/components";
import { useDataStore } from "@/hooks/useDataStore";
import type { Item, SourceId } from "@/types";
import { formatPercent, formatValue } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";

function Ranking({ title, entries }: { title: string; entries: TrendEntry[] }) {
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
  const generatedAt = useDataStore((state) => state.snapshotMeta?.generatedAt);

  const source: SourceId = (() => {
    const preferred = toEngineMode(mode);
    if (preferred !== "consensus" && items.some((item) => item.values[preferred]))
      return preferred;
    return items.some((item) => item.values.mm2values) ? "mm2values" : "supreme";
  })();
  const latestSyncItems = useMemo(
    () =>
      generatedAt
        ? items.filter((item) => item.values[source]?.updatedAt === generatedAt)
        : [],
    [generatedAt, items, source],
  );
  const latestMovers = biggestMovers(
    latestSyncItems,
    source,
    "both",
    Number.MAX_SAFE_INTEGER,
  );
  const rises = latestMovers.filter((entry) => entry.changePercent > 0).slice(0, 8);
  const falls = latestMovers.filter((entry) => entry.changePercent < 0).slice(0, 8);
  const hottest = useMemo(() => {
    return [...latestSyncItems]
      .map((item) => {
        const reading = item.values[source];
        const movement = Math.abs(reading?.trendPercent ?? 0);
        const demand = reading?.demand ?? 0;
        return { item, score: demand * 2 + movement };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [latestSyncItems, source]);
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
