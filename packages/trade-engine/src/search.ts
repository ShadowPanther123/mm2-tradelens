import type {
  Item,
  ItemCategory,
  ItemRarity,
  SourceId,
} from "@tradelens/item-schema";

/**
 * Item search that tolerates misspellings, aliases, abbreviations, plurals,
 * chroma variants and set (origin) names. Intentionally dependency-free so it
 * can run on both the desktop app and the browser extension.
 */

export interface SearchResult {
  item: Item;
  /** 0–1, higher is a better match. */
  score: number;
  /** Which field produced the match. */
  matchedOn: "name" | "alias" | "abbrev" | "set" | "fuzzy";
}

/** Optional constraints applied before scoring. */
export interface SearchFilters {
  /** Keep only items in one of these categories. */
  categories?: readonly ItemCategory[] | ItemCategory;
  /** Keep only items in one of these rarities. */
  rarities?: readonly ItemRarity[] | ItemRarity;
  /** Keep only items that carry a reading from at least one of these sources. */
  sources?: readonly SourceId[] | SourceId;
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalise(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function singularise(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Initials of a multi-word phrase, e.g. "ice piercer" -> "ip". */
function acronym(normalised: string): string {
  const words = normalised.split(" ").filter(Boolean);
  if (words.length < 2) return "";
  return words.map((w) => w[0]).join("");
}

/** Bounded Levenshtein distance (returns maxDistance + 1 once exceeded). */
export function levenshtein(a: string, b: string, maxDistance = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

interface Indexed {
  item: Item;
  name: string;
  nameSingular: string;
  aliases: string[];
  /** Initials, e.g. "ip" for "Ice Piercer". */
  acronym: string;
  /** Normalised set / origin name, e.g. "christmas 2022". */
  set: string;
}

/** Below very short queries fuzzy matching produces mostly noise. */
const MIN_FUZZY_QUERY_LENGTH = 4;

function toArray<T>(value: readonly T[] | T | undefined): readonly T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : ([value] as readonly T[]);
}

function topValueOf(item: Item): number {
  let max = 0;
  for (const v of Object.values(item.values ?? {})) {
    if (v && v.value > max) max = v.value;
  }
  return max;
}

/** A prepared, reusable search index. */
export class SearchIndex {
  private readonly entries: Indexed[];

  constructor(items: Item[]) {
    this.entries = items.map((item) => {
      const name = normalise(item.displayName);
      return {
        item,
        name,
        nameSingular: singularise(name),
        aliases: [
          ...item.aliases.map(normalise),
          ...(item.chroma ? ["chroma " + name] : []),
        ].filter(Boolean),
        acronym: acronym(name),
        set: item.origin ? normalise(item.origin) : "",
      };
    });
  }

  /** Number of indexed items. */
  get size(): number {
    return this.entries.length;
  }

  search(query: string, limit = 8, filters?: SearchFilters): SearchResult[] {
    const q = normalise(query);
    if (q.length === 0) return [];
    const qSingular = singularise(q);
    const allowFuzzy = q.length >= MIN_FUZZY_QUERY_LENGTH;

    const categories = toArray(filters?.categories);
    const rarities = toArray(filters?.rarities);
    const sources = toArray(filters?.sources);

    const results: SearchResult[] = [];
    for (const entry of this.entries) {
      if (categories && !categories.includes(entry.item.category)) continue;
      if (rarities && !rarities.includes(entry.item.rarity)) continue;
      if (sources && !sources.some((s) => entry.item.values?.[s])) continue;

      const match = this.scoreEntry(entry, q, qSingular, allowFuzzy);
      if (match.score > 0) {
        results.push({ item: entry.item, ...match });
      }
    }

    // Primary: score. Ties (e.g. duplicate-looking names) are broken so the
    // order is stable and the more useful item wins: verified first, then the
    // higher-valued item, then alphabetical for full determinism.
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const av = a.item.verified ?? true;
      const bv = b.item.verified ?? true;
      if (av !== bv) return av ? -1 : 1;
      const avVal = topValueOf(a.item);
      const bvVal = topValueOf(b.item);
      if (bvVal !== avVal) return bvVal - avVal;
      return a.item.displayName.localeCompare(b.item.displayName);
    });
    return results.slice(0, limit);
  }

  private scoreEntry(
    entry: Indexed,
    q: string,
    qSingular: string,
    allowFuzzy: boolean,
  ): { score: number; matchedOn: SearchResult["matchedOn"] } {
    // Exact / prefix name matches score highest so exact beats fuzzy.
    if (entry.name === q || entry.nameSingular === qSingular) {
      return { score: 1, matchedOn: "name" };
    }
    if (entry.name.startsWith(q)) {
      return { score: 0.9, matchedOn: "name" };
    }
    if (entry.name.includes(q)) {
      return { score: 0.75, matchedOn: "name" };
    }

    // Abbreviation / acronym, e.g. "ip" -> "Ice Piercer".
    if (entry.acronym && entry.acronym === q) {
      return { score: 0.8, matchedOn: "abbrev" };
    }

    // Alias matches (explicit alternate spellings and abbreviations).
    for (const alias of entry.aliases) {
      if (alias === q) return { score: 0.85, matchedOn: "alias" };
      if (alias.startsWith(q)) return { score: 0.7, matchedOn: "alias" };
      if (alias.includes(q)) return { score: 0.6, matchedOn: "alias" };
    }

    // Set / origin name, e.g. "christmas" -> every Christmas 2022 item.
    if (entry.set && q.length >= 3) {
      if (entry.set === q) return { score: 0.65, matchedOn: "set" };
      if (entry.set.includes(q)) return { score: 0.5, matchedOn: "set" };
    }

    // Fuzzy fallback for misspellings — suppressed for very short queries,
    // where it would surface mostly unrelated results.
    if (!allowFuzzy) return { score: 0, matchedOn: "fuzzy" };
    const maxDistance = q.length <= 7 ? 2 : 3;
    const distance = Math.min(
      levenshtein(q, entry.name, maxDistance),
      levenshtein(qSingular, entry.nameSingular, maxDistance),
    );
    if (distance <= maxDistance) {
      const score = 0.55 * (1 - distance / (maxDistance + 1));
      return { score, matchedOn: "fuzzy" };
    }

    return { score: 0, matchedOn: "fuzzy" };
  }
}

/** Convenience one-shot search. */
export function searchItems(
  items: Item[],
  query: string,
  limit = 8,
  filters?: SearchFilters,
): SearchResult[] {
  return new SearchIndex(items).search(query, limit, filters);
}
