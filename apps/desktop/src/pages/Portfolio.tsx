import { useEffect, useMemo, useState } from "react";
import { resolveValue } from "@tradelens/trade-engine";
import { EmptyState, ItemIcon, SearchBar, StatPill } from "@/components";
import { getAllValueHistory } from "@/database";
import { useDataStore } from "@/hooks/useDataStore";
import type { HistoryPoint, Item } from "@/types";
import { formatSignedValue, formatValue } from "@/utils/format";
import { summarizePortfolio } from "@/utils/portfolio";
import { toEngineMode } from "@/utils/sourceMode";

export function Portfolio() {
  const entries = useDataStore((state) => state.portfolio);
  const items = useDataStore((state) => state.items);
  const itemById = useDataStore((state) => state.itemById);
  const mode = useDataStore((state) => state.settings.sourceMode);
  const setQuantity = useDataStore((state) => state.setPortfolioQuantity);
  const remove = useDataStore((state) => state.removePortfolio);
  const revision = useDataStore((state) => state.snapshotMeta?.revision ?? 0);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    getAllValueHistory()
      .then((points) => active && setHistory(points))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [revision]);

  const summary = useMemo(
    () => summarizePortfolio(entries, items, history, mode),
    [entries, history, items, mode],
  );

  function add(item: Item) {
    const current = entries.find((entry) => entry.itemId === item.id)?.quantity ?? 0;
    void setQuantity(item.id, current + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <p className="text-sm text-slate-500">
          Track your inventory and its value movement.
        </p>
      </div>

      <SearchBar placeholder="Add an owned item…" onPick={add} pickLabel="Own" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4">
          <StatPill label="Inventory" value={String(summary.inventory)} />
        </div>
        <div className="card p-4">
          <StatPill label="Value" value={formatValue(summary.value)} />
        </div>
        <div className="card p-4">
          <StatPill
            label="Today"
            value={formatSignedValue(summary.todayChange)}
            accent={summary.todayChange >= 0 ? "up" : "down"}
          />
        </div>
        <div className="card p-4">
          <StatPill
            label="Week"
            value={formatSignedValue(summary.weekChange)}
            accent={summary.weekChange >= 0 ? "up" : "down"}
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="◇"
          title="Your portfolio is empty"
          hint="Add everything you own to see its current value and movement."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => {
            const item = itemById(entry.itemId);
            if (!item) return null;
            const unit = resolveValue(item, toEngineMode(mode))?.value ?? 0;
            return (
              <div key={entry.itemId} className="card flex items-center gap-3 p-3">
                <ItemIcon
                  category={item.category}
                  image={item.image}
                  alt={item.displayName}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.displayName}</div>
                  <div className="text-xs text-slate-500">
                    {formatValue(unit)} each · {formatValue(unit * entry.quantity)}{" "}
                    total
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="icon-btn"
                    aria-label={`Decrease ${item.displayName}`}
                    onClick={() => void setQuantity(item.id, entry.quantity - 1)}
                  >
                    −
                  </button>
                  <input
                    className="input w-16 px-2 text-center tabular-nums"
                    aria-label={`Quantity of ${item.displayName}`}
                    type="number"
                    min={1}
                    max={10000}
                    value={drafts[item.id] ?? String(entry.quantity)}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                    onBlur={() => {
                      const parsed = Number(drafts[item.id] ?? entry.quantity);
                      void setQuantity(
                        item.id,
                        Number.isFinite(parsed) ? parsed : entry.quantity,
                      );
                      setDrafts((current) => {
                        const next = { ...current };
                        delete next[item.id];
                        return next;
                      });
                    }}
                  />
                  <button
                    className="icon-btn"
                    aria-label={`Increase ${item.displayName}`}
                    onClick={() => void setQuantity(item.id, entry.quantity + 1)}
                  >
                    +
                  </button>
                </div>
                <button
                  className="icon-btn icon-btn-danger"
                  aria-label={`Remove ${item.displayName} from portfolio`}
                  onClick={() => void remove(item.id)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
