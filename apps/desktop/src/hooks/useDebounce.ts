import { useEffect, useState } from "react";

/** Debounce a rapidly-changing value (e.g. a search query). */
export function useDebounce<T>(value: T, delayMs = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
