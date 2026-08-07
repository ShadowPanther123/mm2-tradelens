import { useMemo, useState } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { useSearch } from "@/hooks/useSearch";
import { ItemRow, EmptyState, VirtualList } from "@/components";
import type { Item, ItemCategory, ItemRarity, SourceId } from "@/types";
import type { SearchFilters } from "@tradelens/trade-engine";
import { cn } from "@/utils/cn";

const CATEGORIES: Array<{ id: ItemCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "knife", label: "Knives" },
  { id: "gun", label: "Guns" },
  { id: "pet", label: "Pets" },
  { id: "bundle", label: "Bundles" },
  { id: "other", label: "Other" },
];

const RARITIES: Array<{ id: ItemRarity | "all"; label: string }> = [
  { id: "all", label: "Any rarity" },
  { id: "common", label: "Common" },
  { id: "uncommon", label: "Uncommon" },
  { id: "rare", label: "Rare" },
  { id: "legendary", label: "Legendary" },
  { id: "godly", label: "Godly" },
  { id: "ancient", label: "Ancient" },
  { id: "unique", label: "Unique" },
  { id: "vintage", label: "Vintage" },
  { id: "chroma", label: "Chroma" },
  { id: "pet", label: "Pet" },
  { id: "misc", label: "Misc" },
];

const SOURCES: Array<{ id: SourceId | "all"; label: string }> = [
  { id: "all", label: "Any source" },
  { id: "supreme", label: "Supreme Values" },
  { id: "mm2values", label: "MM2Values" },
  { id: "community", label: "Community" },
];

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

  const displayItems: Item[] = searching ? searchResults.map((r) => r.item) : browseList;

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
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={cn(
              "chip border px-3 py-1",
              category === c.id
                ? "border-accent/50 bg-accent/15 text-white"
                : "border-line text-slate-400 hover:text-slate-200",
            )}
          >
            {c.label}
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
          {RARITIES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          aria-label="Filter by source availability"
          value={source}
          onChange={(e) => setSource(e.target.value as SourceId | "all")}
        >
          {SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {displayItems.length === 0 ? (
        <EmptyState title="No items match" hint="Try a different name or adjust the filters." />
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
