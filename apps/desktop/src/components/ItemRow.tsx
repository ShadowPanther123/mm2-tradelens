import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { Item, SourceMode } from "@/types";
import { useDataStore } from "@/hooks/useDataStore";
import { ItemIcon } from "./ItemIcon";
import { RarityBadge } from "./RarityBadge";
import { UnverifiedBadge } from "./UnverifiedBadge";
import { ValueBadge } from "./ValueBadge";
import { cn } from "@/utils/cn";
import { resolveValue } from "@tradelens/trade-engine";
import { toEngineMode } from "@/utils/sourceMode";

interface ItemRowProps {
  item: Item;
  mode: SourceMode;
  onAdd?: (item: Item) => void;
  addLabel?: string;
  valueDetail?: ReactNode;
}

/** A compact one-line item entry used in search results and lists. */
export function ItemRow({
  item,
  mode,
  onAdd,
  addLabel = "Add",
  valueDetail,
}: ItemRowProps) {
  const isFavorite = useDataStore((s) => s.isFavorite(item.id));
  const toggleFavorite = useDataStore((s) => s.toggleFavorite);
  const recordItemSearch = useDataStore((s) => s.recordItemSearch);

  return (
    <div
      className="glass-soft flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:border-accent/40"
      data-testid="item-row"
      data-item-id={item.id}
      data-category={item.category}
      data-rarity={item.rarity}
      data-sources={Object.keys(item.values).sort().join(",")}
    >
      <ItemIcon
        category={item.category}
        image={item.image}
        alt={item.displayName}
        size="sm"
      />
      <Link
        to={`/item/${item.id}`}
        className="min-w-0 flex-1"
        onClick={() => void recordItemSearch(item.id).catch(() => undefined)}
      >
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-100">
            {item.displayName}
          </span>
          {isFavorite && <span className="text-accent">★</span>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <RarityBadge rarity={item.rarity} />
          <UnverifiedBadge item={item} />
          {item.origin && (
            <span className="truncate text-[11px] text-slate-500">{item.origin}</span>
          )}
        </div>
      </Link>
      <ValueBadge item={item} mode={mode} extra={valueDetail} />
      <button
        type="button"
        className={cn("icon-btn", isFavorite && "text-accent")}
        onClick={() => {
          const baseline = resolveValue(item, toEngineMode(mode))?.value ?? 0;
          void toggleFavorite(item.id, baseline);
        }}
        aria-label={`${isFavorite ? "Unpin" : "Pin"} ${item.displayName}`}
        title={isFavorite ? "Remove from watchlist" : "Add to watchlist"}
      >
        {isFavorite ? "★" : "☆"}
      </button>
      {onAdd && (
        <button
          className={cn("btn btn-ghost px-2.5 py-1.5 text-xs")}
          onClick={() => onAdd(item)}
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}
