import { useDataStore } from "@/hooks/useDataStore";
import { useTradeStore } from "@/hooks/useTradeStore";
import type { Item, SourceMode, TradeSlot } from "@/types";
import { resolveValue } from "@tradelens/trade-engine";
import { formatValue } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";
import { SearchBar } from "./SearchBar";
import { ItemIcon } from "./ItemIcon";
import { cn } from "@/utils/cn";

type Side = "your" | "their";

interface TradeSideCardProps {
  side: Side;
  title: string;
  total: number;
  mode: SourceMode;
}

/** One column of the trade calculator (your offer or their offer). */
export function TradeSideCard({ side, title, total, mode }: TradeSideCardProps) {
  const slots = useTradeStore((s) => (side === "your" ? s.your : s.their));
  const add = useTradeStore((s) => s.add);
  const remove = useTradeStore((s) => s.remove);
  const setQuantity = useTradeStore((s) => s.setQuantity);
  const itemById = useDataStore((s) => s.itemById);

  const accent = side === "your" ? "border-yourside/40" : "border-theirside/40";

  return (
    <div className={cn("card flex flex-col gap-3 border-t-2 p-4", accent)}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-sm tabular-nums text-slate-400">
          {formatValue(total)}
        </span>
      </div>

      <SearchBar
        placeholder="Add an item…"
        pickLabel="Add"
        onPick={(item: Item) => add(side, item.id)}
      />

      <div className="flex min-h-[120px] flex-col gap-2">
        {slots.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            No items yet — search above to add some.
          </p>
        )}
        {slots.map((slot: TradeSlot) => {
          const item = itemById(slot.itemId);
          if (!item) return null;
          const resolved = resolveValue(item, toEngineMode(mode));
          const lineValue = (resolved?.value ?? 0) * slot.quantity;
          return (
            <div
              key={slot.itemId}
              className="glass-soft flex items-center gap-2 rounded-xl px-2.5 py-2"
            >
              <ItemIcon category={item.category} image={item.image} alt={item.displayName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{item.displayName}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  {/* Disambiguate similarly-named / chroma variants. */}
                  <span className="capitalize">{item.rarity}</span>
                  {item.chroma && (
                    <span className="rounded bg-fuchsia-500/20 px-1 text-fuchsia-300">
                      Chroma
                    </span>
                  )}
                  <span className="tabular-nums">· {formatValue(lineValue)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/5 transition-colors hover:bg-white/10 disabled:opacity-40"
                  aria-label={`Decrease quantity of ${item.displayName}`}
                  disabled={slot.quantity <= 1}
                  onClick={() =>
                    setQuantity(side, slot.itemId, Math.max(1, slot.quantity - 1))
                  }
                >
                  <span aria-hidden="true">−</span>
                </button>
                <span className="w-6 text-center text-sm tabular-nums">
                  {slot.quantity}
                </span>
                <button
                  type="button"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/5 transition-colors hover:bg-white/10"
                  aria-label={`Increase quantity of ${item.displayName}`}
                  onClick={() => setQuantity(side, slot.itemId, slot.quantity + 1)}
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
              <button
                type="button"
                className="icon-btn icon-btn-danger h-6 w-6"
                onClick={() => remove(side, slot.itemId)}
                aria-label={`Remove ${item.displayName}`}
                title="Remove"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
