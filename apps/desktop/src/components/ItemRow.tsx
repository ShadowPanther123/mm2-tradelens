import { Link } from "react-router-dom";
import type { Item, SourceMode } from "@/types";
import { useDataStore } from "@/hooks/useDataStore";
import { ItemIcon } from "./ItemIcon";
import { RarityBadge } from "./RarityBadge";
import { UnverifiedBadge } from "./UnverifiedBadge";
import { ValueBadge } from "./ValueBadge";
import { cn } from "@/utils/cn";

interface ItemRowProps {
  item: Item;
  mode: SourceMode;
  onAdd?: (item: Item) => void;
  addLabel?: string;
}

/** A compact one-line item entry used in search results and lists. */
export function ItemRow({ item, mode, onAdd, addLabel = "Add" }: ItemRowProps) {
  const isFavorite = useDataStore((s) => s.isFavorite(item.id));

  return (
    <div className="glass-soft flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:border-accent/40">
      <ItemIcon category={item.category} image={item.image} alt={item.displayName} size="sm" />
      <Link to={`/item/${item.id}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-100">{item.displayName}</span>
          {isFavorite && <span className="text-accent">★</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <RarityBadge rarity={item.rarity} />
          <UnverifiedBadge item={item} />
          {item.origin && (
            <span className="truncate text-[11px] text-slate-500">{item.origin}</span>
          )}
        </div>
      </Link>
      <ValueBadge item={item} mode={mode} />
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
