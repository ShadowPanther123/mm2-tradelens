import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  biggestAbsoluteMovers,
  historyMovers,
  mergeHistoryReadings,
  mostContested,
  snapshotHistory,
  stableHighDemand,
  type HistoryReading,
} from "@tradelens/trade-engine";
import { useDataStore } from "@/hooks/useDataStore";
import { getAllValueHistory } from "@/database";
import { ItemRow, StatPill, TrendBars, Sparkline, EmptyState } from "@/components";
import { formatPercent, formatSignedValue, capitalise } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";
import { logger } from "@/services/logger";
import type { Item, SourceId } from "@/types";

type Window = 7 | 30 | 90;

const WINDOWS: { id: Window; label: string }[] = [
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
  { id: 90, label: "90 days" },
];

export function Trends() {
  const items = useDataStore((s) => s.items);
  const mode = useDataStore((s) => s.settings.sourceMode);
  const revision = useDataStore((s) => s.snapshotMeta?.revision ?? 0);

  const [days, setDays] = useState<Window>(7);
  const [category, setCategory] = useState<string>("all");
  const [dbHistory, setDbHistory] = useState<Map<string, HistoryReading[]>>(new Map());

  // Load the locally recorded time series once (and whenever a new revision is
  // adopted) so movers reflect points captured on this device too.
  useEffect(() => {
    let active = true;
    getAllValueHistory()
      .then((rows) => {
        if (!active) return;
        const grouped = new Map<string, HistoryReading[]>();
        for (const p of rows) {
          const bucket = grouped.get(p.itemId);
          const reading: HistoryReading = {
            source: p.source,
            value: p.value,
            revision: p.revision,
            recordedAt: p.recordedAt,
          };
          if (bucket) bucket.push(reading);
          else grouped.set(p.itemId, [reading]);
        }
        setDbHistory(grouped);
      })
      .catch((err) => {
        logger.warn("trends", "could not load value history", { detail: String(err) });
        if (active) setDbHistory(new Map());
      });
    return () => {
      active = false;
    };
  }, [revision]);

  // Pick a source that actually carries data. The default "combined" mode has
  // no single trend series, so fall back to whichever source is present.
  const engineMode = toEngineMode(mode);
  const availableSources = useMemo(() => {
    const set = new Set<SourceId>();
    for (const item of items) {
      for (const key of Object.keys(item.values)) set.add(key as SourceId);
    }
    return [...set];
  }, [items]);
  const preferred = engineMode === "consensus" ? undefined : (engineMode as SourceId);
  const trendSource: SourceId =
    preferred && availableSources.includes(preferred)
      ? preferred
      : (availableSources[0] ?? "mm2values");

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(item.category);
    return ["all", ...[...set].sort()];
  }, [items]);

  const scopedItems = useMemo<Item[]>(
    () => (category === "all" ? items : items.filter((it) => it.category === category)),
    [items, category],
  );

  // Merge the snapshot's embedded series with locally recorded points, favouring
  // the richer local series when it has enough points to be meaningful.
  const history = useMemo(() => {
    const merged = snapshotHistory(scopedItems, trendSource);
    for (const item of scopedItems) {
      const embedded = merged.get(item.id) ?? [];
      const local = (dbHistory.get(item.id) ?? []).filter(
        (r) => r.source === trendSource,
      );
      const combined = mergeHistoryReadings(embedded, local);
      if (combined.length > 0) merged.set(item.id, combined);
    }
    return merged;
  }, [scopedItems, dbHistory, trendSource]);

  const windowDays = days;

  const rising = historyMovers(scopedItems, history, trendSource, {
    days: windowDays,
    direction: "up",
    limit: 6,
  });
  const falling = historyMovers(scopedItems, history, trendSource, {
    days: windowDays,
    direction: "down",
    limit: 6,
  });
  // Rankings reset on every adopted snapshot; graph series retain the selected
  // historical window for the items that moved.
  const recentMovement = useMemo(() => {
    const up = historyMovers(scopedItems, history, trendSource, {
      days: windowDays,
      direction: "up",
      limit: 6,
    });
    const down = historyMovers(scopedItems, history, trendSource, {
      days: windowDays,
      direction: "down",
      limit: 6,
    });
    return [...up, ...down].sort(
      (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent),
    );
  }, [scopedItems, history, trendSource, windowDays]);
  const biggestSwings = biggestAbsoluteMovers(scopedItems, history, trendSource, {
    days: windowDays,
    limit: 6,
  });
  const steady = stableHighDemand(scopedItems, trendSource, 4, 6);
  const contested = mostContested(scopedItems, 6);

  const avgMove =
    recentMovement.length > 0
      ? recentMovement.reduce((sum, m) => sum + Math.abs(m.changePercent), 0) /
        recentMovement.length
      : 0;

  const nothingMoving = recentMovement.length === 0 && biggestSwings.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Charts &amp; trends</h1>
          <p className="text-sm text-slate-500">
            A gentle overview of what&apos;s been moving lately — no rush to act on any
            of it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex rounded-xl bg-white/5 p-0.5"
            role="group"
            aria-label="Time window"
          >
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setDays(w.id)}
                aria-pressed={days === w.id}
                className={
                  "rounded-lg px-2.5 py-1 text-xs transition " +
                  (days === w.id
                    ? "bg-accent/20 text-accent"
                    : "text-slate-400 hover:text-slate-200")
                }
              >
                {w.label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="trend-category">
            Filter by category
          </label>
          <select
            id="trend-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl bg-white/5 px-2.5 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-accent/40"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All categories" : capitalise(c)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <span className="sr-only" data-testid="trends-history-ready">
          {dbHistory.size} local series merged with snapshot history
        </span>
        <div className="card p-4">
          <StatPill label="Rising items" value={String(rising.length)} />
        </div>
        <div className="card p-4">
          <StatPill label="Easing items" value={String(falling.length)} />
        </div>
        <div className="card p-4">
          <StatPill label="Avg movement" value={formatPercent(avgMove, false)} />
        </div>
      </div>

      {nothingMoving ? (
        <section className="card p-4">
          <EmptyState
            title="Nothing has moved in this window"
            hint="Try a longer time window, or check each item's details page for its full history."
          />
        </section>
      ) : (
        <>
          <section className="card p-4" data-testid="latest-sync-changes">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Recent movement</h2>
              <span className="text-xs text-slate-500">
                {days}-day graphs ·{" "}
                {trendSource === mode ? trendSource : `via ${trendSource}`}
              </span>
            </div>
            <TrendBars entries={recentMovement} />
          </section>

          <div className="grid grid-cols-2 gap-4">
            <section className="card p-4">
              <h2 className="mb-3 font-semibold text-win">Rising</h2>
              <div className="flex flex-col gap-2">
                {rising.length === 0 && (
                  <p className="py-3 text-center text-sm text-slate-500">
                    Nothing rising notably.
                  </p>
                )}
                {rising.map((m) => (
                  <Link
                    key={m.item.id}
                    to={`/item/${m.item.id}`}
                    className="glass-soft flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:border-accent/40"
                  >
                    <span className="truncate text-sm font-medium">
                      {m.item.displayName}
                    </span>
                    <div className="flex items-center gap-2">
                      <Sparkline points={m.series} tone="up" width={64} height={22} />
                      <span className="w-14 text-right text-xs tabular-nums text-win">
                        {formatPercent(m.changePercent)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="card p-4">
              <h2 className="mb-3 font-semibold text-loss">Easing</h2>
              <div className="flex flex-col gap-2">
                {falling.length === 0 && (
                  <p className="py-3 text-center text-sm text-slate-500">
                    Nothing easing notably.
                  </p>
                )}
                {falling.map((m) => (
                  <Link
                    key={m.item.id}
                    to={`/item/${m.item.id}`}
                    className="glass-soft flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:border-accent/40"
                  >
                    <span className="truncate text-sm font-medium">
                      {m.item.displayName}
                    </span>
                    <div className="flex items-center gap-2">
                      <Sparkline points={m.series} tone="down" width={64} height={22} />
                      <span className="w-14 text-right text-xs tabular-nums text-loss">
                        {formatPercent(m.changePercent)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          {biggestSwings.length > 0 && (
            <section className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Biggest swings</h2>
                <span className="text-xs text-slate-500">By raw value moved</span>
              </div>
              <div className="flex flex-col gap-2">
                {biggestSwings.map((m) => (
                  <Link
                    key={m.item.id}
                    to={`/item/${m.item.id}`}
                    className="glass-soft flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:border-accent/40"
                  >
                    <span className="truncate text-sm font-medium">
                      {m.item.displayName}
                    </span>
                    <div className="flex items-center gap-2">
                      <Sparkline
                        points={m.series}
                        tone={m.changeAbsolute >= 0 ? "up" : "down"}
                        width={64}
                        height={22}
                      />
                      <span
                        className={
                          "w-20 text-right text-xs tabular-nums " +
                          (m.changeAbsolute >= 0 ? "text-win" : "text-loss")
                        }
                      >
                        {formatSignedValue(m.changeAbsolute)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Steady &amp; in demand</h2>
          <span className="text-xs text-slate-500">Calm holds</span>
        </div>
        <div className="flex flex-col gap-2">
          {steady.length === 0 && (
            <p className="py-3 text-center text-sm text-slate-500">
              No steady high-demand items in this source yet.
            </p>
          )}
          {steady.map((item) => (
            <ItemRow key={item.id} item={item} mode={mode} />
          ))}
        </div>
      </section>

      {contested.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Worth a second look</h2>
            <span className="text-xs text-slate-500">Sources disagree</span>
          </div>
          <div className="flex flex-col gap-2">
            {contested.map((item) => (
              <ItemRow key={item.id} item={item} mode={mode} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
