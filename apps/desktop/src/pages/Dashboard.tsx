import { Link } from "react-router-dom";
import { biggestMovers } from "@tradelens/trade-engine";
import { useDataStore } from "@/hooks/useDataStore";
import {
  SearchBar,
  StalenessBanner,
  SampleDataBanner,
  ItemRow,
  StatPill,
} from "@/components";
import { formatPercent, trendArrow } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";
import type { SourceId } from "@/types";

export function Dashboard() {
  const items = useDataStore((s) => s.items);
  const mode = useDataStore((s) => s.settings.sourceMode);
  const favorites = useDataStore((s) => s.favorites);
  const history = useDataStore((s) => s.history);
  const portfolio = useDataStore((s) => s.portfolio);
  const itemById = useDataStore((s) => s.itemById);
  const generatedAt = useDataStore((s) => s.snapshotMeta?.generatedAt);

  // Pick a concrete source for trend display (consensus has no trend field).
  const engineMode = toEngineMode(mode);
  const trendSource: SourceId = engineMode === "consensus" ? "mm2values" : engineMode;
  const latestSyncItems = generatedAt
    ? items.filter((item) => item.values[trendSource]?.updatedAt === generatedAt)
    : [];
  const movers = biggestMovers(latestSyncItems, trendSource, "both", 5);

  const favoriteItems = favorites
    .map((f) => itemById(f.itemId))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Look up values, compare sources and check trades — calmly.
        </p>
      </div>

      <StalenessBanner />
      <SampleDataBanner />

      <SearchBar placeholder="Search any item…" autoFocus />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card flex flex-col gap-1 p-4">
          <StatPill label="Items tracked" value={String(items.length)} />
        </div>
        <div className="card flex flex-col gap-1 p-4">
          <StatPill label="Favorites" value={String(favorites.length)} />
        </div>
        <div className="card flex flex-col gap-1 p-4">
          <StatPill label="Saved trades" value={String(history.length)} />
        </div>
        <div className="card flex flex-col gap-1 p-4">
          <StatPill
            label="Portfolio items"
            value={String(portfolio.reduce((sum, entry) => sum + entry.quantity, 0))}
          />
        </div>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Newest sync changes</h2>
          <Link to="/search" className="text-xs text-accent hover:underline">
            Browse all
          </Link>
        </div>
        <div className="flex flex-col gap-2">
          {movers.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">
              Nothing notable is moving right now.
            </p>
          )}
          {movers.map((m) => (
            <Link
              key={m.item.id}
              to={`/item/${m.item.id}`}
              className="glass-soft flex items-center justify-between rounded-xl px-3 py-2.5 hover:border-accent/40"
            >
              <span className="font-medium">{m.item.displayName}</span>
              <span
                className={
                  m.changePercent >= 0
                    ? "text-win tabular-nums"
                    : "text-loss tabular-nums"
                }
              >
                {trendArrow(m.changePercent / 100)} {formatPercent(m.changePercent)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {favoriteItems.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Your favorites</h2>
            <Link to="/favorites" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {favoriteItems.map((item) => (
              <ItemRow key={item.id} item={item} mode={mode} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
