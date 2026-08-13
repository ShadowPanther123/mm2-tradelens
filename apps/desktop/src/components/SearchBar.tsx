import { useState } from "react";
import { useSearch } from "@/hooks/useSearch";
import { useDataStore } from "@/hooks/useDataStore";
import type { Item } from "@/types";
import { ItemRow } from "./ItemRow";

interface SearchBarProps {
  placeholder?: string;
  onPick?: (item: Item) => void;
  pickLabel?: string;
  autoFocus?: boolean;
}

/** Search input with a live dropdown of results. */
export function SearchBar({
  placeholder = "Search items…",
  onPick,
  pickLabel = "Add",
  autoFocus = false,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const results = useSearch(query, 8);
  const mode = useDataStore((s) => s.settings.sourceMode);
  const recordItemSearch = useDataStore((s) => s.recordItemSearch);

  function pick(item: Item) {
    void recordItemSearch(item.id).catch(() => undefined);
    onPick?.(item);
    if (onPick) {
      setQuery("");
      setFocused(false);
    }
  }

  const showResults = focused && results.length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
        >
          ⌕
        </span>
        <input
          className="input pl-10"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      </div>
      {showResults && (
        <div className="absolute z-20 mt-2 flex w-full flex-col gap-1.5 rounded-xl border border-line bg-base-800/95 p-2 shadow-glass backdrop-blur-xl">
          {results.map((r) => (
            <ItemRow
              key={r.item.id}
              item={r.item}
              mode={mode}
              onAdd={onPick ? pick : undefined}
              addLabel={pickLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
