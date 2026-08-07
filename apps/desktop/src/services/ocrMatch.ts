import type { SearchIndex } from "@tradelens/trade-engine";
import type { Item } from "@/types";

/**
 * Pure, DOM-free analysis of OCR output. Kept isolated from the browser-only
 * OCR engine so the matching pipeline can be unit-tested in a plain Node
 * environment and reused regardless of how the words were produced.
 *
 * The pipeline is deliberately conservative: it ignores low-confidence text,
 * discards ordinary interface words, groups words into on-screen regions, and
 * prevents the same item being detected twice from overlapping phrases. Nothing
 * here adds items to a trade — it only proposes candidates for the user to
 * review.
 */

/** A single word read from the image, with Tesseract's 0–100 confidence. */
export interface OcrWord {
  text: string;
  /** Tesseract word confidence, 0–100. */
  confidence: number;
  /** Pixel bounding box in the (preprocessed) image, when available. */
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

/** One item the pipeline believes it saw, plus safer alternatives to pick from. */
export interface OcrCandidate {
  /** The best-matching item for this region. */
  item: Item;
  /** 0–1 match score from the search index. */
  score: number;
  /** The text that produced the match, e.g. "ice piercer". */
  sourceText: string;
  /** Mean OCR confidence (0–100) of the words behind this match. */
  wordConfidence: number;
  /** True when the match is worth a second look before trusting it. */
  uncertain: boolean;
  /** Other plausible items for the same text, best first. */
  alternatives: Array<{ item: Item; score: number }>;
}

export interface OcrMatchOptions {
  /** Words below this Tesseract confidence (0–100) are ignored. */
  minWordConfidence?: number;
  /** Search matches below this score (0–1) are discarded. */
  minScore?: number;
  /** Maximum candidates returned. */
  maxResults?: number;
  /** At or below this score a match is flagged uncertain. */
  uncertainBelowScore?: number;
  /** At or below this mean word confidence a match is flagged uncertain. */
  uncertainBelowWordConfidence?: number;
}

/** Ignore words the OCR engine was not reasonably sure about. */
export const MIN_WORD_CONFIDENCE = 55;
const MIN_SCORE = 0.6;
const MAX_RESULTS = 12;
const UNCERTAIN_BELOW_SCORE = 0.85;
const UNCERTAIN_BELOW_WORD_CONFIDENCE = 70;
const MAX_PHRASE_WORDS = 3;

/**
 * Ordinary trade-window and interface words that are never item names. Keeping
 * these out sharply reduces false positives from buttons, labels and chrome.
 */
const UI_STOPWORDS = new Set<string>([
  "trade", "trades", "trading", "accept", "accepted", "decline", "declined",
  "cancel", "cancelled", "confirm", "confirmed", "ready", "unready", "waiting",
  "offer", "offers", "offering", "request", "requests", "requesting",
  "your", "yours", "their", "theirs", "you", "them", "they", "me", "my", "mine",
  "value", "values", "valued", "worth", "price", "prices", "total", "totals",
  "demand", "trend", "trends", "stable", "rising", "falling", "overpay",
  "robux", "coins", "tokens", "gems", "cash", "credits",
  "inventory", "backpack", "storage", "sort", "search", "filter", "filters",
  "add", "remove", "removed", "added", "item", "items", "select", "selected",
  "chat", "report", "block", "invite", "party", "friend", "friends",
  "settings", "setting", "options", "menu", "close", "back", "next", "done",
  "okay", "yes", "no", "on", "off", "and", "the", "for", "with", "from", "to",
  "mm2", "murder", "mystery", "roblox", "server", "servers", "level", "rank",
  "quantity", "amount", "each", "per", "all", "none", "empty", "slot", "slots",
  "godly", "godlys", "vintage", "ancient", "legendary", "rare", "uncommon",
  "common", "unique", "chroma", "chromas",
]);

/** True when a word is interface chrome or otherwise not part of an item name. */
export function isUiNoise(text: string): boolean {
  const word = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (word.length <= 1) return true;
  if (/^\d+$/.test(word)) return true;
  return UI_STOPWORDS.has(word);
}

/** Keep only words that clear the confidence floor and are not interface noise. */
export function filterWords(
  words: OcrWord[],
  minConfidence = MIN_WORD_CONFIDENCE,
): OcrWord[] {
  return words.filter(
    (w) => w.confidence >= minConfidence && !isUiNoise(w.text),
  );
}

/**
 * Group words into likely item-name regions. When bounding boxes are present,
 * words that sit on the same horizontal band (their vertical centres overlap)
 * are treated as one line/region. Without geometry we fall back to a single
 * region preserving reading order.
 */
export function groupRegions(words: OcrWord[]): OcrWord[][] {
  const withBox = words.filter((w) => w.bbox);
  if (withBox.length === 0) return words.length ? [words] : [];

  const heights = withBox.map((w) => w.bbox!.y1 - w.bbox!.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 1;
  const tolerance = Math.max(4, medianHeight * 0.6);

  const sorted = [...withBox].sort((a, b) => {
    const ay = (a.bbox!.y0 + a.bbox!.y1) / 2;
    const by = (b.bbox!.y0 + b.bbox!.y1) / 2;
    if (Math.abs(ay - by) > tolerance) return ay - by;
    return a.bbox!.x0 - b.bbox!.x0;
  });

  const regions: OcrWord[][] = [];
  let current: OcrWord[] = [];
  let bandCentre = 0;
  for (const word of sorted) {
    const centre = (word.bbox!.y0 + word.bbox!.y1) / 2;
    if (current.length === 0 || Math.abs(centre - bandCentre) <= tolerance) {
      current.push(word);
      const centres = current.map((w) => (w.bbox!.y0 + w.bbox!.y1) / 2);
      bandCentre = centres.reduce((s, c) => s + c, 0) / centres.length;
    } else {
      regions.push(current);
      current = [word];
      bandCentre = centre;
    }
  }
  if (current.length) regions.push(current);
  return regions;
}

interface SpanMatch {
  start: number;
  end: number; // exclusive
  item: Item;
  score: number;
  text: string;
}

/** Search every 1–N word phrase in a region, remembering the token span it came from. */
function scoreRegion(
  index: SearchIndex,
  region: OcrWord[],
  minScore: number,
): SpanMatch[] {
  const spans: SpanMatch[] = [];
  for (let i = 0; i < region.length; i++) {
    for (let n = 1; n <= MAX_PHRASE_WORDS && i + n <= region.length; n++) {
      const slice = region.slice(i, i + n);
      const phrase = slice.map((w) => w.text).join(" ").trim();
      if (phrase.length < 2) continue;
      for (const hit of index.search(phrase, 4)) {
        if (hit.score < minScore) continue;
        spans.push({ start: i, end: i + n, item: hit.item, score: hit.score, text: phrase });
      }
    }
  }
  return spans;
}

function overlaps(a: SpanMatch, b: SpanMatch): boolean {
  return a.start < b.end && b.start < a.end;
}

function meanConfidence(region: OcrWord[], start: number, end: number): number {
  const slice = region.slice(start, end);
  if (slice.length === 0) return 0;
  return slice.reduce((s, w) => s + w.confidence, 0) / slice.length;
}

/**
 * Turn raw OCR words into reviewable item candidates. Overlapping phrases are
 * resolved greedily by score so a single label never yields duplicate items,
 * and each surviving span keeps its runner-up matches as alternatives.
 */
export function analyzeOcr(
  index: SearchIndex,
  words: OcrWord[],
  options: OcrMatchOptions = {},
): OcrCandidate[] {
  const minWordConfidence = options.minWordConfidence ?? MIN_WORD_CONFIDENCE;
  const minScore = options.minScore ?? MIN_SCORE;
  const maxResults = options.maxResults ?? MAX_RESULTS;
  const uncertainBelowScore = options.uncertainBelowScore ?? UNCERTAIN_BELOW_SCORE;
  const uncertainBelowWordConfidence =
    options.uncertainBelowWordConfidence ?? UNCERTAIN_BELOW_WORD_CONFIDENCE;

  const regions = groupRegions(filterWords(words, minWordConfidence));

  const candidates: OcrCandidate[] = [];
  for (const region of regions) {
    const spans = scoreRegion(index, region, minScore).sort((a, b) => b.score - a.score);

    const taken: SpanMatch[] = [];
    for (const span of spans) {
      // Skip spans that overlap an already-chosen (higher-scoring) one so a
      // single on-screen label cannot produce two competing item detections.
      if (taken.some((t) => overlaps(t, span) && t.item.id === span.item.id)) continue;
      if (taken.some((t) => overlaps(t, span))) {
        // Overlaps a chosen span but a different item: keep only as an
        // alternative of that span rather than a separate candidate.
        continue;
      }
      taken.push(span);
    }

    for (const chosen of taken) {
      const alternatives = spans
        .filter(
          (s) => overlaps(s, chosen) && s.item.id !== chosen.item.id,
        )
        .sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const dedupedAlternatives: Array<{ item: Item; score: number }> = [];
      for (const alt of alternatives) {
        if (seen.has(alt.item.id)) continue;
        seen.add(alt.item.id);
        dedupedAlternatives.push({ item: alt.item, score: alt.score });
      }

      const wordConfidence = meanConfidence(region, chosen.start, chosen.end);
      const uncertain =
        chosen.score <= uncertainBelowScore ||
        wordConfidence <= uncertainBelowWordConfidence;

      candidates.push({
        item: chosen.item,
        score: chosen.score,
        sourceText: chosen.text,
        wordConfidence,
        uncertain,
        alternatives: dedupedAlternatives.slice(0, 3),
      });
    }
  }

  // Collapse the same item detected in different regions, keeping the best.
  const best = new Map<string, OcrCandidate>();
  for (const candidate of candidates) {
    const prev = best.get(candidate.item.id);
    if (!prev || candidate.score > prev.score) best.set(candidate.item.id, candidate);
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
