import type { Item, ItemCategory, ItemRarity, SourceId } from "@tradelens/item-schema";

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

function compact(normalised: string): string {
  return normalised.replace(/\s/g, "");
}

/** Ordered-letter abbreviation, e.g. "ip" → "icepiercer", "cdb" → "chroma darkbringer". */
function abbreviationScore(query: string, candidate: string): number {
  if (query.length < 2 || candidate.length <= query.length || candidate[0] !== query[0]) return 0;
  let cursor = 0;
  let gap = 0;
  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;
    if (i === 1 && query.length === 2) {
      const midpoint = Math.max(cursor, Math.floor(candidate.length * 0.35));
      const foundLater = candidate.indexOf(char, midpoint);
      if (foundLater >= 0) {
        gap += foundLater - cursor;
        cursor = foundLater + 1;
        continue;
      }
    }
    const found = candidate.indexOf(char, cursor);
    if (found < 0) return 0;
    gap += found - cursor;
    cursor = found + 1;
  }
  const density = query.length / Math.max(query.length, cursor + gap * 0.25);
  return 0.56 + density * 0.1;
}

/** Bounded Levenshtein distance (returns maxDistance + 1 once exceeded). */
export function levenshtein(a: string, b: string, maxDistance = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const prevPrev = new Array(b.length + 1).fill(0);
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prevPrev[j - 2] + 1);
      }
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j++) {
      prevPrev[j] = prev[j];
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}

interface Indexed {
  item: Item;
  name: string;
  nameSingular: string;
  compactName: string;
  words: string[];
  aliases: string[];
  compactAliases: string[];
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
      const aliases = [
        ...item.aliases.map(normalise),
        ...(item.chroma && !name.startsWith("chroma ") ? ["chroma " + name] : []),
      ].filter(Boolean);
      return {
        item,
        name,
        nameSingular: singularise(name),
        compactName: compact(name),
        words: name.split(" "),
        aliases,
        compactAliases: aliases.map(compact),
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
    const qCompact = compact(q);
    const allowFuzzy = q.length >= MIN_FUZZY_QUERY_LENGTH;

    const categories = toArray(filters?.categories);
    const rarities = toArray(filters?.rarities);
    const sources = toArray(filters?.sources);

    const results: SearchResult[] = [];
    for (const entry of this.entries) {
      if (categories && !categories.includes(entry.item.category)) continue;
      if (rarities && !rarities.includes(entry.item.rarity)) continue;
      if (sources && !sources.some((s) => entry.item.values?.[s])) continue;

      const match = this.scoreEntry(entry, q, qSingular, qCompact, allowFuzzy);
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
    qCompact: string,
    allowFuzzy: boolean,
  ): { score: number; matchedOn: SearchResult["matchedOn"] } {
    // Exact / prefix name matches score highest so exact beats fuzzy.
    if (entry.name === q || entry.nameSingular === qSingular) {
      return { score: 1, matchedOn: "name" };
    }
    if (entry.compactName === qCompact) {
      return { score: 0.96, matchedOn: "name" };
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
    for (let i = 0; i < entry.aliases.length; i++) {
      const alias = entry.aliases[i]!;
      const compactAlias = entry.compactAliases[i]!;
      if (alias === q) return { score: 0.85, matchedOn: "alias" };
      if (compactAlias === qCompact) return { score: 0.82, matchedOn: "alias" };
      if (alias.startsWith(q)) return { score: 0.7, matchedOn: "alias" };
      if (alias.includes(q)) return { score: 0.6, matchedOn: "alias" };
    }
    const generatedAbbreviation = abbreviationScore(qCompact, entry.compactName);
    if (generatedAbbreviation > 0) {
      return { score: generatedAbbreviation, matchedOn: "abbrev" };
    }

    // Set / origin name, e.g. "christmas" -> every Christmas 2022 item.
    if (entry.set && q.length >= 3) {
      if (entry.set === q) return { score: 0.65, matchedOn: "set" };
      if (entry.set.includes(q)) return { score: 0.5, matchedOn: "set" };
    }

    // Multi-word typo fallback: match each query word to one candidate word.
    const queryWords = q.split(" ").filter(Boolean);
    if (allowFuzzy && queryWords.length > 1) {
      const candidateWords = [entry.words, ...entry.aliases.map((alias) => alias.split(" "))];
      for (const words of candidateWords) {
        const distances = queryWords.map((queryWord) =>
          Math.min(
            ...words.map((word) =>
              word.startsWith(queryWord)
                ? 0
                : levenshtein(queryWord, word, queryWord.length <= 7 ? 2 : 3),
            ),
          ),
        );
        const total = distances.reduce((sum, value) => sum + value, 0);
        if (distances.every((value) => value <= 2) && total <= 3) {
          return { score: 0.5 - total * 0.06, matchedOn: "fuzzy" };
        }
      }
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
