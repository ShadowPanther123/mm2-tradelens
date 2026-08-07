import { useState } from "react";
import { resolveValue } from "@tradelens/trade-engine";
import { useDataStore } from "@/hooks/useDataStore";
import { useToast } from "@/contexts/ToastContext";
import { ItemRow, EmptyState, StatPill } from "@/components";
import { formatPercent, formatValue } from "@/utils/format";
import { toEngineMode } from "@/utils/sourceMode";
import { downloadTextFile, pickTextFile } from "@/utils/download";
import type { SourceMode } from "@/types";
import {
  resolveFavorites,
  exportFavorites,
  parseFavoritesImport,
  type ResolvedFavorite,
} from "@/utils/favorites";

export function Favorites() {
  const favorites = useDataStore((s) => s.favorites);
  const items = useDataStore((s) => s.items);
  const mode = useDataStore((s) => s.settings.sourceMode);
  const toggleFavorite = useDataStore((s) => s.toggleFavorite);
  const clearFavorites = useDataStore((s) => s.clearFavorites);
  const importFavorites = useDataStore((s) => s.importFavorites);
  const { notify } = useToast();
  const [confirmingClear, setConfirmingClear] = useState(false);

  const resolved = resolveFavorites(favorites, items);
  const retiredCount = resolved.filter((r) => r.status === "retired").length;

  function handleExport() {
    downloadTextFile(`tradelens-favorites-${Date.now()}.json`, exportFavorites(favorites));
    notify("Favorites exported", "success");
  }

  async function handleImport() {
    try {
      const text = await pickTextFile();
      if (text === null) return;
      const incoming = parseFavoritesImport(text);
      if (incoming.length === 0) {
        notify("No favorites found in that file", "info");
        return;
      }
      const added = await importFavorites(incoming);
      notify(
        added > 0
          ? `Imported ${added} favorite${added === 1 ? "" : "s"}`
          : "Those favorites were already saved",
        added > 0 ? "success" : "info",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not import favorites", "error");
    }
  }

  async function handleClear() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    await clearFavorites();
    setConfirmingClear(false);
    notify("All favorites removed", "info");
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">Favorites</h1>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost" onClick={handleImport}>
          Import
        </button>
        <button className="btn btn-ghost" onClick={handleExport} disabled={favorites.length === 0}>
          Export
        </button>
        {confirmingClear ? (
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmingClear(false)}>
              Keep
            </button>
            <button className="btn btn-danger" onClick={handleClear}>
              Remove all
            </button>
          </>
        ) : (
          <button
            className="btn btn-ghost"
            onClick={handleClear}
            disabled={favorites.length === 0}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          icon="★"
          title="No favorites yet"
          hint="Star items from their detail page to keep an eye on them here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      {confirmingClear && (
        <p className="text-sm text-slate-500">Remove all {favorites.length} favorites?</p>
      )}
      {retiredCount > 0 && (
        <p className="text-sm text-amber-400/90">
          {retiredCount} favorite{retiredCount === 1 ? " is" : "s are"} no longer in the current
          value list. They are kept here so you can review or remove them.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {resolved.map((entry) => (
          <FavoriteEntry
            key={entry.favorite.itemId}
            entry={entry}
            mode={mode}
            onRemove={() => toggleFavorite(entry.favorite.itemId, 0)}
          />
        ))}
      </div>
    </div>
  );
}

function FavoriteEntry({
  entry,
  mode,
  onRemove,
}: {
  entry: ResolvedFavorite;
  mode: SourceMode;
  onRemove: () => void;
}) {
  const { favorite, item, status, remappedTo } = entry;

  if (!item) {
    return (
      <div className="card flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-300">{favorite.itemId}</div>
          <div className="text-[11px] text-amber-400/90">Retired · not in the current list</div>
        </div>
        <div className="flex items-center gap-4">
          <StatPill label="Since starred" value={formatValue(favorite.baselineValue)} />
          <button
            className="icon-btn icon-btn-danger"
            onClick={onRemove}
            aria-label={`Remove ${favorite.itemId} from favorites`}
            title="Remove favorite"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </div>
    );
  }

  const resolvedValue = resolveValue(item, toEngineMode(mode));
  const now = resolvedValue?.value ?? 0;
  const change =
    favorite.baselineValue > 0 ? ((now - favorite.baselineValue) / favorite.baselineValue) * 100 : 0;

  return (
    <div className="flex flex-col gap-1">
      <ItemRow item={item} mode={mode} />
      <div className="flex items-center gap-6 px-3 pb-1">
        <StatPill label="Since starred" value={formatValue(favorite.baselineValue)} />
        <StatPill
          label="Change"
          value={formatPercent(change)}
          accent={change >= 0 ? "up" : "down"}
        />
        {status === "remapped" && (
          <span className="text-[11px] text-sky-400/90">
            Moved to “{remappedTo}” after an update
          </span>
        )}
      </div>
    </div>
  );
}
