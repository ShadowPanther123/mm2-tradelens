import type { SourceValue, Stability, ValueSnapshot } from "@tradelens/item-schema";

/**
 * In-app Supreme Values import.
 *
 * SupremeValues sits behind bot protection and renders its grid client-side, so
 * it cannot be fetched automatically. This module parses a capture the user
 * saved from their OWN, already-loaded browser session (a saved `.html` page,
 * the copied page text, or a JSON export) and merges it into the current value
 * snapshot. It never bypasses access controls, hotlinks images, or invents data
 * a source did not provide — it only rewrites the `supreme` reading on items
 * that already exist in the snapshot.
 *
 * It is a browser-safe, dependency-free port of the `supreme` half of
 * `scripts/sync-values.mjs`, so the desktop app can offer drag-and-drop import
 * without the Node CLI.
 */

const SUPREME_ADAPTER_VERSION = "supreme-import-1.0.0";

/** A normalised Supreme row parsed from a capture. */
export interface SupremeRow {
  name: string;
  value: number;
  demand?: number;
  rarity?: number;
  stability?: string;
}

/** Outcome of merging a Supreme capture into a snapshot. */
export interface SupremeMergeReport {
  /** Rows parsed from the capture. */
  parsed: number;
  /** Rows that matched an item and changed its supreme reading. */
  changed: number;
  /** Rows that matched an item that had no prior supreme reading. */
  added: number;
  /** Rows that matched no item in the snapshot. */
  unmatched: number;
  /** The revision of the returned snapshot (bumped only when something changed). */
  revision: number;
  /** A few example changes, for user feedback. */
  samples: Array<{ id: string; name: string; from: number; to: number }>;
}

// ---------------------------------------------------------------------------
// Helpers (ported from scripts/sync-values.mjs, kept byte-compatible)
// ---------------------------------------------------------------------------

/** Turn a display name into a stable slug id. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strip a trailing " Value: 12,345" suffix some chroma names carry. */
export function cleanName(name: string): string {
  return name.replace(/\s*Value:\s*[\d,]+\s*$/i, "").trim();
}

/** Rescale a source 0–11 rating onto the schema's 0–5 range. */
function scale05(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  const scaled = Math.max(0, Math.min(5, (n * 5) / 11));
  return Math.round(scaled * 100) / 100;
}

/**
 * Normalise a source stability label to the schema's enum. Only labels that
 * describe a value actively on the move count as moving; valuation judgements
 * like "Overpaid For" or "Doing Well" read as steady.
 */
function mapStability(raw: string | undefined): Stability | undefined {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "" || t === "n/a") return undefined;
  if (t.includes("volatile")) return "volatile";
  if (
    t.includes("fluctuat") ||
    t.includes("unstable") ||
    t.includes("receding") ||
    t.includes("recede") ||
    t.includes("peaking") ||
    t.includes("rising") ||
    t.includes("rise") ||
    t.includes("lower") ||
    t.includes("drop") ||
    t.includes("fall") ||
    t.includes("climb") ||
    t.includes("hard to")
  ) {
    return "fluctuating";
  }
  return "stable";
}

/** Parse a possibly comma-grouped number ("2,175" → 2175). */
function toNumber(text: unknown): number | undefined {
  const n = Number.parseFloat(String(text ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a value token that may carry a K/M/B suffix ("124K" → 124000,
 * "1.2M" → 1200000, "36,250" → 36250).
 */
export function parseValueToken(token: unknown): number | undefined {
  if (token == null) return undefined;
  const t = String(token).replace(/,/g, "").trim();
  const m = t.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) return toNumber(t);
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2] ? ({ k: 1e3, m: 1e6, b: 1e9 } as const)[m[2].toLowerCase() as "k" | "m" | "b"] : 1;
  return Math.round(n * mult);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Normalise a Supreme Values JSON payload (`{ items: [...] }` or a bare array). */
export function parseSupremePayload(payload: unknown): SupremeRow[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { items?: unknown[] })?.items)
      ? (payload as { items: unknown[] }).items
      : [];
  const rows: SupremeRow[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    const name = typeof raw?.name === "string" ? cleanName(raw.name) : undefined;
    const value = toNumber(raw?.value);
    if (!name || value === undefined) continue;
    rows.push({
      name,
      value,
      demand: raw?.demand !== undefined ? toNumber(raw.demand) : undefined,
      rarity: raw?.rarity !== undefined ? toNumber(raw.rarity) : undefined,
      stability: typeof raw?.stability === "string" ? raw.stability : undefined,
    });
  }
  return rows;
}

/**
 * Parse a saved SupremeValues page (HTML) into normalised rows. Each item is a
 * head + body pair: `<div class="itemhead">Name</div>` followed by a body with
 * `<b class="itemvalue val-top">75,000</b>`, an `itemstability` label, and
 * `Demand - <b>8</b>` (rarity optional).
 */
export function parseSupremeHtml(html: string): SupremeRow[] {
  const rows: SupremeRow[] = [];
  const parts = html.split(/<div\s+class=["']?itemhead["']?[^>]*>/i).slice(1);
  for (const part of parts) {
    const name = part.match(/^\s*([^<]+?)\s*<\/div>/i)?.[1];
    if (!name) continue;
    const body = part.split(/<div\s+class=["']?itemhead["']?/i)[0];

    const value = toNumber(
      body.match(/class=["'][^"']*itemvalue[^"']*["'][^>]*>\s*([\d,]+)/i)?.[1],
    );
    if (value === undefined) continue;

    const stability = body
      .match(/class=["'][^"']*itemstability[^"']*["'][^>]*>\s*([^<]+?)\s*<\/b>/i)?.[1]
      ?.trim();
    const demand = toNumber(body.match(/Demand\s*[-–:]\s*<b[^>]*>\s*([\d.]+)/i)?.[1]);
    const rarity = toNumber(body.match(/Rarity\s*[-–:]\s*<b[^>]*>\s*([\d.]+)/i)?.[1]);

    rows.push({ name: cleanName(name), value, demand, rarity, stability });
  }
  return rows;
}

/**
 * Parse a SupremeValues category page captured as plain text (from the
 * browser's `document.body.innerText`). Each item renders as a block whose name
 * is the line immediately preceding its "Value -" line.
 */
export function parseSupremeText(text: string): SupremeRow[] {
  const rows: SupremeRow[] = [];
  const lines = text.split(/\r?\n/);
  const isHeader = (s: string): boolean =>
    /^(chroma|small|collectible|bulk|dynamic|value|standard|special|victim|premium|limited|event|shop|classic)\s+tier$/i.test(
      s,
    ) ||
    /^\d{4}$/.test(s) ||
    /^(value|stability|demand|rarity|owner|origin|class|exp requirement|change in value)\b/i.test(s);

  for (let i = 0; i < lines.length; i++) {
    const vm = lines[i].match(/^\s*Value\s*[-–]\s*([\d.,KMB]+)\s*(?:\[[^\]]*\])?/i);
    if (!vm) continue;
    const value = parseValueToken(vm[1]);
    if (value === undefined) continue;

    let name: string | undefined;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      const cand = lines[j].trim();
      if (cand && !isHeader(cand)) {
        name = cleanName(cand);
        break;
      }
    }
    if (!name) continue;

    const window = lines.slice(i + 1, i + 5).join("\n");
    const stability = window.match(/Stability\s*[-–]\s*([^\n]+?)\s*(?:\n|$)/i)?.[1]?.trim();
    const demand = toNumber(window.match(/Demand\s*[-–]\s*([\d.]+)/i)?.[1]);
    const rarity = toNumber(window.match(/Rarity\s*[-–]\s*([\d.]+)/i)?.[1]);

    rows.push({ name, value, stability, demand, rarity });
  }
  return rows;
}

/**
 * Parse a SupremeValues capture in whichever form the user provided: JSON
 * export, rendered HTML, or copied page text. Returns [] if none match.
 */
export function parseSupremeCapture(text: string): SupremeRow[] {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseSupremePayload(JSON.parse(text));
    } catch {
      /* fall through to text/html parsing */
    }
  }
  const html = parseSupremeHtml(text);
  if (html.length > 0) return html;
  return parseSupremeText(text);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Build the supreme source reading for a parsed row, tracking previous value. */
function buildReading(row: SupremeRow, now: string, previous?: SourceValue): SourceValue {
  const value = row.value;
  const previousValue = previous?.value;
  const trendPercent =
    previousValue && previousValue > 0
      ? Math.round(((value - previousValue) / previousValue) * 10000) / 100
      : undefined;
  const reading: SourceValue = {
    value,
    updatedAt: now,
    importedAt: now,
    retrievedAt: now,
    adapterVersion: SUPREME_ADAPTER_VERSION,
    extractionMethod: "manual-entry",
    validation: "ok",
  };
  const demand = scale05(row.demand);
  if (demand !== undefined) reading.demand = demand;
  const rarityScore = scale05(row.rarity);
  if (rarityScore !== undefined) reading.rarityScore = rarityScore;
  const stability = mapStability(row.stability);
  if (stability !== undefined) reading.stability = stability;
  if (trendPercent !== undefined) reading.trendPercent = trendPercent;
  if (previousValue !== undefined && previousValue !== value) reading.previousValue = previousValue;
  return reading;
}

/** True when a fresh reading differs from the stored one in a meaningful way. */
function readingChanged(prev: SourceValue | undefined, next: SourceValue): boolean {
  if (!prev) return true;
  const near = (a?: number, b?: number): boolean => Math.abs((a ?? 0) - (b ?? 0)) > 1e-9;
  return (
    prev.value !== next.value ||
    near(prev.demand, next.demand) ||
    near(prev.rarityScore, next.rarityScore) ||
    (prev.stability ?? "") !== (next.stability ?? "")
  );
}

/**
 * Merge a parsed Supreme capture into a snapshot. Returns a NEW snapshot (the
 * input is not mutated); when nothing changed the returned snapshot keeps the
 * original revision so the update check reports "already current".
 *
 * Only items that already exist in the snapshot are updated — Supreme rows
 * without a matching item are counted as `unmatched`, never invented.
 */
export function mergeSupremeCapture(
  snapshot: ValueSnapshot,
  captureOrRows: string | SupremeRow[],
  now: string = new Date().toISOString(),
): { snapshot: ValueSnapshot; report: SupremeMergeReport } {
  const rows = typeof captureOrRows === "string" ? parseSupremeCapture(captureOrRows) : captureOrRows;

  // Work on a deep copy so callers can keep the original snapshot intact.
  const next: ValueSnapshot = JSON.parse(JSON.stringify(snapshot));

  // Index items by display-name slug (ids may carry collision suffixes).
  const bySlug = new Map<string, ValueSnapshot["items"]>();
  for (const item of next.items) {
    const key = slugify(item.displayName);
    const bucket = bySlug.get(key);
    if (bucket) bucket.push(item);
    else bySlug.set(key, [item]);
  }

  const report: SupremeMergeReport = {
    parsed: rows.length,
    changed: 0,
    added: 0,
    unmatched: 0,
    revision: next.revision,
    samples: [],
  };

  for (const row of rows) {
    const bucket = bySlug.get(slugify(row.name)) ?? [];
    let target = bucket.length === 1 ? bucket[0] : undefined;
    if (bucket.length > 1) {
      target = bucket.find((it) => it.displayName.toLowerCase() === row.name.toLowerCase());
    }
    if (!target) {
      report.unmatched++;
      continue;
    }

    const prev = target.values?.supreme;
    const reading = buildReading(row, now, prev);
    if (!readingChanged(prev, reading)) continue;

    target.values = target.values ?? {};
    target.values.supreme = reading;
    if (prev) {
      report.changed++;
      if (report.samples.length < 50) {
        report.samples.push({
          id: target.id,
          name: target.displayName,
          from: prev.value,
          to: reading.value,
        });
      }
    } else {
      report.added++;
    }
  }

  const total = report.changed + report.added;
  if (total > 0) {
    next.revision = (next.revision ?? 0) + 1;
    next.generatedAt = now;
    if (!next.sources.includes("supreme")) next.sources = [...next.sources, "supreme"];
    report.revision = next.revision;
  }

  return { snapshot: next, report };
}
