import { useMemo } from "react";
import type { SearchFilters, SearchResult } from "@tradelens/trade-engine";
import { useDataStore } from "./useDataStore";
import { useDebounce } from "./useDebounce";

/** Fuzzy item search backed by the shared trade-engine index. */
export function useSearch(
  query: string,
  limit = 10,
  filters?: SearchFilters,
): SearchResult[] {
  const index = useDataStore((s) => s.index);
  const debounced = useDebounce(query, 120);
  // Serialise the filters so the memo only recomputes when they actually change.
  const filterKey = filters ? JSON.stringify(filters) : "";
  return useMemo(() => {
    if (debounced.trim().length === 0) return [];
    return index.search(debounced, limit, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, debounced, limit, filterKey]);
}
