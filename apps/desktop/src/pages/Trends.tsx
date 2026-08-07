import { Link } from "react-router-dom";
import { biggestMovers, mostContested, stableHighDemand } from "@tradelens/trade-engine";
import { useDataStore } from "@/hooks/useDataStore";
import { ItemRow, StatPill, TrendBars, Sparkline } from "@/components";
import { formatPercent } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";
import type { SourceId } from "@/types";

export function Trends() {
  const items = useDataStore((s) => s.items);
  const mode = useDataStore((s) => s.settings.sourceMode);

  // Consensus has no single trend field, so pick a concrete source to chart.
  const engineMode = toEngineMode(mode);
  const trendSource: SourceId = engineMode === "consensus" ? "supreme" : engineMode;

  const rising = biggestMovers(items, trendSource, "up", 6);
  const falling = biggestMovers(items, trendSource, "down", 6);
  const allMovers = biggestMovers(items, trendSource, "both", 8);
  const steady = stableHighDemand(items, trendSource, 4, 6);
  const contested = mostContested(items, 6);

  const avgMove =
    allMovers.length > 0
      ? allMovers.reduce((sum, m) => sum + Math.abs(m.changePercent), 0) / allMovers.length
      : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Charts &amp; trends</h1>
        <p className="text-sm text-slate-500">
          A gentle overview of what&apos;s been moving lately — no rush to act on any of it.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
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

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Recent movement</h2>
          <span className="text-xs text-slate-500">
            {trendSource === mode ? trendSource : `via ${trendSource}`}
          </span>
        </div>
        <TrendBars entries={allMovers} />
      </section>

      <div className="grid grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold text-win">Rising</h2>
          <div className="flex flex-col gap-2">
            {rising.length === 0 && (
              <p className="py-3 text-center text-sm text-slate-500">Nothing rising notably.</p>
            )}
            {rising.map((m) => (
              <Link
                key={m.item.id}
                to={`/item/${m.item.id}`}
                className="glass-soft flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:border-accent/40"
              >
                <span className="truncate text-sm font-medium">{m.item.displayName}</span>
                <div className="flex items-center gap-2">
                  <Sparkline
                    points={[m.previousValue ?? m.value, m.value]}
                    tone="up"
                    width={64}
                    height={22}
                  />
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
              <p className="py-3 text-center text-sm text-slate-500">Nothing easing notably.</p>
            )}
            {falling.map((m) => (
              <Link
                key={m.item.id}
                to={`/item/${m.item.id}`}
                className="glass-soft flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:border-accent/40"
              >
                <span className="truncate text-sm font-medium">{m.item.displayName}</span>
                <div className="flex items-center gap-2">
                  <Sparkline
                    points={[m.previousValue ?? m.value, m.value]}
                    tone="down"
                    width={64}
                    height={22}
                  />
                  <span className="w-14 text-right text-xs tabular-nums text-loss">
                    {formatPercent(m.changePercent)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

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
