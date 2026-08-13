import { useEffect, useMemo, useState } from "react";
import { EmptyState, StatPill } from "@/components";
import { useDataStore } from "@/hooks/useDataStore";
import { communityFeedConfigured, listCommunityTrades } from "@/services/community";
import type { CommunityTrade, TradeSlot } from "@/types";
import { formatSignedValue } from "@/utils/format";

function sideLabel(slots: TradeSlot[], nameOf: (id: string) => string): string {
  return slots
    .map(
      (slot) =>
        `${nameOf(slot.itemId)}${slot.quantity > 1 ? ` ×${slot.quantity}` : ""}`,
    )
    .join(" + ");
}

export function Community() {
  const [trades, setTrades] = useState<CommunityTrade[]>([]);
  const [loading, setLoading] = useState(communityFeedConfigured);
  const itemById = useDataStore((state) => state.itemById);

  useEffect(() => {
    if (!communityFeedConfigured) return;
    let active = true;
    listCommunityTrades()
      .then((next) => active && setTrades(next))
      .catch(() => active && setTrades([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const pairings = useMemo(() => {
    const map = new Map<string, { trade: CommunityTrade; count: number }>();
    for (const trade of trades) {
      const key = JSON.stringify([trade.gave, trade.received]);
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { trade, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [trades]);
  const nameOf = (id: string) => itemById(id)?.displayName ?? id;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Community trades</h1>
        <p className="text-sm text-slate-500">
          Anonymous trades shared only with explicit permission.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <StatPill label="Shared trades" value={String(trades.length)} />
        </div>
        <div className="card p-4">
          <StatPill label="Common pairings" value={String(pairings.length)} />
        </div>
      </div>
      {!communityFeedConfigured ? (
        <EmptyState
          icon="◉"
          title="Community feed is optional"
          hint="Configure the community API URL to enable anonymous sharing and live trade patterns."
        />
      ) : loading ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Loading community trades…
        </div>
      ) : pairings.length === 0 ? (
        <EmptyState
          icon="◉"
          title="No shared trades yet"
          hint="Shared trades will appear here after users opt in from Trade History."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {pairings.map(({ trade, count }) => (
            <div
              key={trade.id}
              className="card grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4"
            >
              <div className="text-right font-medium">
                {sideLabel(trade.gave, nameOf)}
              </div>
              <div className="text-center text-xs text-slate-500">
                usually traded for
                <br />
                <span className="text-accent">
                  {count} trade{count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="font-medium">
                {sideLabel(trade.received, nameOf)}{" "}
                <span className={trade.difference >= 0 ? "text-win" : "text-loss"}>
                  {formatSignedValue(trade.difference)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
