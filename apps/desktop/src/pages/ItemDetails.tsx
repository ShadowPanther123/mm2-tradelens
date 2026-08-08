import { Link, useParams } from "react-router-dom";
import { resolveValue } from "@tradelens/trade-engine";
import { useDataStore } from "@/hooks/useDataStore";
import {
  ItemIcon,
  RarityBadge,
  UnverifiedBadge,
  SourceComparison,
  StatPill,
  EmptyState,
  ValueHistoryChart,
} from "@/components";
import { capitalise, formatValue } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";

export function ItemDetails() {
  const { id = "" } = useParams();
  const mode = useDataStore((s) => s.settings.sourceMode);
  const thresholdPercent = useDataStore((s) => s.settings.disagreementThresholdPercent);
  const item = useDataStore((s) => s.itemById(id));
  const isFavorite = useDataStore((s) => s.isFavorite(id));
  const toggleFavorite = useDataStore((s) => s.toggleFavorite);

  if (!item) {
    return (
      <EmptyState
        title="Item not found"
        hint="It may not be in the current snapshot."
        icon="◌"
      />
    );
  }

  const resolved = resolveValue(item, toEngineMode(mode));

  return (
    <div className="flex flex-col gap-4">
      <Link to="/search" className="text-xs text-slate-500 hover:text-slate-300">
        ← Back to browse
      </Link>

      <div className="card flex items-center gap-4 p-5">
        <ItemIcon category={item.category} image={item.image} alt={item.displayName} size="lg" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{item.displayName}</h1>
            <RarityBadge rarity={item.rarity} />
            <UnverifiedBadge item={item} />
          </div>
          {item.origin && <p className="text-sm text-slate-500">{item.origin}</p>}
        </div>
        <button
          className={isFavorite ? "btn btn-primary" : "btn"}
          onClick={() => toggleFavorite(item.id, resolved?.value ?? 0)}
        >
          {isFavorite ? "★ Favorited" : "☆ Favorite"}
        </button>
      </div>

      <div className="card grid grid-cols-4 gap-4 p-5">
        <StatPill label="Value" value={resolved ? formatValue(resolved.value) : "—"} />
        <StatPill
          label="Demand"
          value={resolved?.demand !== undefined ? `${resolved.demand.toFixed(1)}/5` : "—"}
        />
        <StatPill
          label="Stability"
          value={resolved?.stability ? capitalise(resolved.stability) : "—"}
        />
        <StatPill
          label="Confidence"
          value={resolved ? capitalise(resolved.confidence) : "—"}
        />
      </div>

      <SourceComparison item={item} thresholdPercent={thresholdPercent} />

      <ValueHistoryChart itemId={item.id} />

      <div className="card grid grid-cols-3 gap-4 p-5 text-sm">
        <StatPill label="Category" value={capitalise(item.category)} />
        {item.year !== undefined && <StatPill label="Year" value={String(item.year)} />}
        <StatPill label="Chroma" value={item.chroma ? "Yes" : "No"} />
      </div>
    </div>
  );
}
