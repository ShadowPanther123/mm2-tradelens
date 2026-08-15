import { useEffect, useMemo, useState } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { useSearch } from "@/hooks/useSearch";
import { ItemRow, EmptyState, VirtualList } from "@/components";
import type { Item, ItemCategory, ItemRarity, SourceId } from "@/types";
import type { SearchFilters } from "@tradelens/trade-engine";
import { cn } from "@/utils/cn";

/**
 * Friendly labels and display order for the browse filters. Only categories,
 * rarities and sources the loaded catalogue actually contains are offered (see
 * the `available*` memos below), so a filter never advertises a bucket that
 * would return nothing — and new ones appear automatically once data arrives.
 */
const CATEGORY_LABELS: Record<ItemCategory, string> = {
  knife: "Knives",
  gun: "Guns",
  pet: "Pets",
  bundle: "Bundles",
  other: "Items",
};
const CATEGORY_ORDER: ItemCategory[] = ["knife", "gun", "pet", "bundle", "other"];

const RARITY_LABELS: Record<ItemRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
  godly: "Godly",
  ancient: "Ancient",
  unique: "Unique",
  vintage: "Vintage",
  chroma: "Chroma",
  pet: "Pet",
  misc: "Misc",
};
const RARITY_ORDER: ItemRarity[] = [
  "common",
  "uncommon",
  "rare",
  "legendary",
  "godly",
  "ancient",
  "unique",
  "vintage",
  "chroma",
  "pet",
  "misc",
];

const SOURCE_LABELS: Record<SourceId, string> = {
  mm2values: "MM2Values",
  supreme: "Supreme Values",
};
const SOURCE_ORDER: SourceId[] = ["mm2values", "supreme"];

/** Above this many rows the results are windowed for smooth scrolling. */
const VIRTUALIZE_THRESHOLD = 30;
const ROW_HEIGHT = 64;
const LIST_HEIGHT = 600;

export function Search() {
  const items = useDataStore((s) => s.items);
  const mode = useDataStore((s) => s.settings.sourceMode);
  const [category, setCategory] = useState<ItemCategory | "all">("all");
  const [rarity, setRarity] = useState<ItemRarity | "all">("all");
  const [source, setSource] = useState<SourceId | "all">("all");
  const [query, setQuery] = useState("");

  // Only offer filter options the loaded catalogue can actually satisfy. This
  // keeps empty, misleading buckets (categories with no items, sources with no
  // data yet) out of the UI and lets any new ones appear once data arrives.
  const availableCategories = useMemo(() => {
    const scoped = items.filter(
      (i) =>
        (rarity === "all" || i.rarity === rarity) &&
        (source === "all" || i.values[source] !== undefined),
    );
    const present = new Set(scoped.map((i) => i.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [items, rarity, source]);

  const availableRarities = useMemo(() => {
    const scoped = items.filter(
      (i) =>
        (category === "all" || i.category === category) &&
        (source === "all" || i.values[source] !== undefined),
    );
    const present = new Set(scoped.map((i) => i.rarity));
    return RARITY_ORDER.filter((r) => present.has(r));
  }, [items, category, source]);

  const availableSources = useMemo(() => {
    const present = new Set<SourceId>();
    const scoped = items.filter(
      (i) =>
        (category === "all" || i.category === category) &&
        (rarity === "all" || i.rarity === rarity),
    );
    for (const i of scoped) {
      for (const key of Object.keys(i.values ?? {})) present.add(key as SourceId);
    }
    return SOURCE_ORDER.filter((s) => present.has(s));
  }, [items, category, rarity]);

  // Drop a selected facet once the other active facets can no longer offer it.
  useEffect(() => {
    if (category !== "all" && !availableCategories.includes(category))
      setCategory("all");
  }, [availableCategories, category]);

  useEffect(() => {
    if (rarity !== "all" && !availableRarities.includes(rarity)) setRarity("all");
  }, [availableRarities, rarity]);

  useEffect(() => {
    if (source !== "all" && !availableSources.includes(source)) setSource("all");
  }, [availableSources, source]);

  const filters = useMemo<SearchFilters>(() => {
    const f: SearchFilters = {};
    if (category !== "all") f.categories = category;
    if (rarity !== "all") f.rarities = rarity;
    if (source !== "all") f.sources = source;
    return f;
  }, [category, rarity, source]);

  const searching = query.trim().length > 0;

  // With a query, results come from the fuzzy trade-engine index (debounced).
  const searchResults = useSearch(query, 200, filters);

  // Without a query, browse the full catalogue with the same filters applied.
  const browseList = useMemo(() => {
    if (searching) return [];
    return items
      .filter((i) => category === "all" || i.category === category)
      .filter((i) => rarity === "all" || i.rarity === rarity)
      .filter((i) => source === "all" || Boolean(i.values?.[source]))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [items, category, rarity, source, searching]);

  const displayItems: Item[] = searching
    ? searchResults.map((r) => r.item)
    : browseList;

  // A single source is the norm, so the picker only earns its place when there
  // is more than one to choose between.
  const showSourceFilter = availableSources.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Browse items</h1>

      <input
        className="input"
        placeholder="Search by name, alias, abbreviation or set…"
        aria-label="Search items"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategory("all")}
          className={cn(
            "chip border px-3 py-1",
            category === "all"
              ? "border-accent/50 bg-accent/15 text-white"
              : "border-line text-slate-400 hover:text-slate-200",
          )}
        >
          All
        </button>
        {availableCategories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "chip border px-3 py-1",
              category === c
                ? "border-accent/50 bg-accent/15 text-white"
                : "border-line text-slate-400 hover:text-slate-200",
            )}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="input w-auto"
          aria-label="Filter by rarity"
          value={rarity}
          onChange={(e) => setRarity(e.target.value as ItemRarity | "all")}
        >
          <option value="all">Any rarity</option>
          {availableRarities.map((r) => (
            <option key={r} value={r}>
              {RARITY_LABELS[r]}
            </option>
          ))}
        </select>
        {showSourceFilter && (
          <select
            className="input w-auto"
            aria-label="Filter by source availability"
            value={source}
            onChange={(e) => setSource(e.target.value as SourceId | "all")}
          >
            <option value="all">Any source</option>
            {availableSources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </div>

      {displayItems.length === 0 ? (
        <EmptyState
          title="No items match"
          hint="Try a different name or adjust the filters."
        />
      ) : displayItems.length > VIRTUALIZE_THRESHOLD ? (
        <VirtualList
          items={displayItems}
          itemHeight={ROW_HEIGHT}
          height={LIST_HEIGHT}
          getKey={(item) => item.id}
          renderItem={(item) => (
            <div className="pb-2">
              <ItemRow item={item} mode={mode} />
            </div>
          )}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {displayItems.map((item) => (
            <ItemRow key={item.id} item={item} mode={mode} />
          ))}
        </div>
      )}
    </div>
  );
}
