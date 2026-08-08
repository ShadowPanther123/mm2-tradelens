// @ts-check
/**
 * Sync the bundled MM2 TradeLens values against the live public value lists.
 *
 * What it does, in one terminal command:
 *   1. Fetches the current values from mm2values.com (all rarity pages).
 *   2. Fetches Supreme Values, when a JSON endpoint is configured (see below).
 *   3. Compares each source's fresh reading against the value already stored in
 *      packages/source-adapters/src/mm2values-snapshot.json.
 *   4. Updates any reading that changed (and adds items new to a source),
 *      bumps the snapshot revision, and writes it back.
 *
 * Run:
 *   node packages/source-adapters/scripts/sync-values.mjs            # apply
 *   node packages/source-adapters/scripts/sync-values.mjs --dry-run  # preview
 *   node packages/source-adapters/scripts/sync-values.mjs --source=mm2values
 *
 * Supreme Values has no documented public API and sits behind bot protection.
 * To include it, save the values page from your own browser (where it renders)
 * and point the tool at the file:
 *   node scripts/sync-values.mjs --supreme-file=./supreme.html
 * or set SUPREME_VALUES_FILE. Alternatively, if you have a permitted endpoint
 * that returns the item JSON ({ "items": [{ "name", "value", "demand",
 * "rarity", "stability" }] }) or the rendered HTML, set SUPREME_VALUES_URL.
 * Without any of these the Supreme source is skipped with a note, not failed.
 *
 * This tool only reads public pages and only rewrites local values in place; it
 * never hotlinks images or invents data a source did not provide.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(here, "../src/mm2values-snapshot.json");

const MM2_BASE = "https://www.mm2values.com";
const USER_AGENT = "mm2-tradelens-sync/1.0 (+local value sync)";
const REQUEST_TIMEOUT_MS = 20_000;
const SYNC_ADAPTER_VERSION = "mm2values-sync-1.0.0";
const SUPREME_ADAPTER_VERSION = "supreme-sync-1.0.0";

/** mm2values.com rarity pages, mapped to the snapshot's source-category word. */
const MM2_CATEGORIES = [
  { param: "ancient", category: "ancient" },
  { param: "unique", category: "unique" },
  { param: "chroma", category: "chroma" },
  { param: "godly", category: "godly" },
  { param: "legend", category: "legendary" },
  { param: "rare", category: "rare" },
  { param: "uncommon", category: "uncommon" },
  { param: "common", category: "common" },
  { param: "vintage", category: "vintage" },
  { param: "pets", category: "pets" },
  { param: "misc", category: "misc" },
];

const RARITY_BY_CATEGORY = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  legendary: "legendary",
  godly: "godly",
  ancient: "ancient",
  unique: "unique",
  vintage: "vintage",
  chroma: "chroma",
  pets: "pet",
  misc: "misc",
};

// ---------------------------------------------------------------------------
// Pure helpers (mirrors packages/source-adapters/scripts/generate-mm2values.mjs
// so imported readings stay identical to the bundled ones).
// ---------------------------------------------------------------------------

/** Turn a display name into a stable slug id. */
export function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strip a trailing " Value: 12,345" suffix some chroma names carry. */
export function cleanName(name) {
  return name.replace(/\s*Value:\s*[\d,]+\s*$/i, "").trim();
}

/** Rescale a source 0–11 rating onto the schema's 0–5 range. */
export function scale05(raw) {
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  const scaled = Math.max(0, Math.min(5, (n * 5) / 11));
  return Math.round(scaled * 100) / 100;
}

/** Normalise a source stability label to the schema's enum. */
export function mapStability(raw) {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "" || t === "n/a") return undefined;
  if (t.includes("fluctuat")) return "fluctuating";
  if (t === "stable") return "stable";
  return "fluctuating";
}

export function mapRarity(category) {
  return RARITY_BY_CATEGORY[category] ?? "misc";
}

export function mapCategory(category) {
  return category === "pets" ? "pet" : "other";
}

/** Drop undefined-valued keys so the emitted JSON stays compact. */
export function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Parse a possibly comma-grouped number ("2,175" → 2175). */
function toNumber(text) {
  const n = Number.parseFloat(String(text ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse one mm2values.com rarity page into normalised rows.
 *
 * Each item on the page is a `<div class=stackable>` block shaped like:
 *   <img src='img/BatwingUpdated.png' ...><b>Batwing</b><br>
 *   Value: 45<br>Range: N/A <br>Demand: 2 - Rarity: 2<br>Stability: Stable<hr>
 *   ...stackValue(i3.value,'45','3')...
 *
 * @param {string} html Raw page HTML.
 * @param {string} category The snapshot source-category word for this page.
 * @returns {Array<{name:string,value:number,demand?:number,rarity?:number,
 *   stability?:string,sourceItemId?:string,imageUrl?:string,category:string}>}
 */
export function parseMm2Html(html, category) {
  /** @type {Array<any>} */
  const rows = [];
  const blocks = html.split(/<div\s+class=stackable\b/i).slice(1);
  for (const block of blocks) {
    // The name sits in the first <b>…</b>. On chroma pages it is wrapped in an
    // inner element (e.g. <b><div class='chroma-text'>Chroma Evergreen</div></b>),
    // so capture the full inner markup and strip any tags before trimming.
    const nameInner = block.match(/<b>([\s\S]*?)<\/b>/i)?.[1];
    const name = nameInner?.replace(/<[^>]+>/g, "").trim();
    if (!name) continue;
    const value = toNumber(block.match(/Value:\s*([\d,]+)/i)?.[1]);
    if (value === undefined) continue;

    const dr = block.match(/Demand:\s*([\d.]+)\s*-\s*Rarity:\s*([\d.]+)/i);
    const stability = block.match(/Stability:\s*([^<]+?)\s*<(?:hr|br)/i)?.[1]?.trim();
    const sourceItemId = block.match(/stackValue\([^,]+,\s*'[\d.]+'\s*,\s*'(\d+)'\)/i)?.[1];
    const imageFile = block.match(/<img\s+src=['"]?img\/([^'"\s>]+)/i)?.[1];

    rows.push({
      name: cleanName(name),
      value,
      demand: dr ? toNumber(dr[1]) : undefined,
      rarity: dr ? toNumber(dr[2]) : undefined,
      stability,
      sourceItemId,
      imageUrl: imageFile ? `${MM2_BASE}/img/${imageFile}` : undefined,
      category,
    });
  }
  return rows;
}

/**
 * Normalise a Supreme Values JSON payload into rows. Accepts either
 * `{ items: [...] }` or a bare array; each entry needs at least `name` and a
 * numeric `value`.
 *
 * @param {unknown} payload
 * @returns {Array<{name:string,value:number,demand?:number,rarity?:number,
 *   stability?:string}>}
 */
export function parseSupremePayload(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(/** @type {any} */ (payload)?.items)
      ? /** @type {any} */ (payload).items
      : [];
  /** @type {Array<any>} */
  const rows = [];
  for (const raw of list) {
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
 * Parse a saved SupremeValues page (HTML) into normalised rows.
 *
 * Each item on the page is rendered as a head + body pair:
 *   <div class="itemhead">Chroma Evergun</div>
 *   <div class="itembody"> Value - <b class="itemvalue val-top">75,000</b>
 *     <b class="itemrange">[N/A]</b><br>
 *     Stability - <b class="itemstability stable">Stable</b>
 *     <img src="../media/stability/Stable.webp"><br>
 *     Demand - <b>8</b> ... (Rarity - <b>..</b> when present)
 *   </div>
 *
 * The site is behind bot protection, so this parser operates on HTML the user
 * has saved from their own browser session — it never bypasses access controls.
 *
 * @param {string} html Raw saved page HTML.
 * @returns {Array<{name:string,value:number,demand?:number,rarity?:number,
 *   stability?:string}>}
 */
export function parseSupremeHtml(html) {
  /** @type {Array<any>} */
  const rows = [];
  // Split on each item's head; the body follows immediately after.
  const parts = html.split(/<div\s+class=["']?itemhead["']?[^>]*>/i).slice(1);
  for (const part of parts) {
    const name = part.match(/^\s*([^<]+?)\s*<\/div>/i)?.[1];
    if (!name) continue;
    // Restrict matching to this item's body (up to the next head/itemhead).
    const body = part.split(/<div\s+class=["']?itemhead["']?/i)[0];

    const value = toNumber(body.match(/class=["'][^"']*itemvalue[^"']*["'][^>]*>\s*([\d,]+)/i)?.[1]);
    if (value === undefined) continue;

    const stability = body
      .match(/class=["'][^"']*itemstability[^"']*["'][^>]*>\s*([^<]+?)\s*<\/b>/i)?.[1]
      ?.trim();
    // "Demand - <b>8</b>" and "Rarity - <b>4</b>" (rarity is optional).
    const demand = toNumber(body.match(/Demand\s*[-–:]\s*<b[^>]*>\s*([\d.]+)/i)?.[1]);
    const rarity = toNumber(body.match(/Rarity\s*[-–:]\s*<b[^>]*>\s*([\d.]+)/i)?.[1]);

    rows.push({ name: cleanName(name), value, demand, rarity, stability });
  }
  return rows;
}

/**
 * Parse a value token that may carry a K/M/B suffix ("124K" → 124000,
 * "1.2M" → 1200000, "36,250" → 36250).
 */
export function parseValueToken(token) {
  if (token == null) return undefined;
  const t = String(token).replace(/,/g, "").trim();
  const m = t.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) return toNumber(t);
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] : 1;
  return Math.round(n * mult);
}

/**
 * Parse a SupremeValues category page captured as plain text (from the
 * browser's `document.body.innerText`, which the user copies from their own
 * challenge-passed session — no access controls are bypassed).
 *
 * Each item renders as a block:
 *   Chroma Ever Set
 *   Value - 124K [123K - 124K]
 *   Stability - Underpaid For
 *   Demand - 8Rarity - 8
 *   Change in Value - (-1,000) -0.8%
 *
 * The item name is the line immediately preceding its "Value -" line.
 *
 * @param {string} text
 * @returns {Array<{name:string,value:number,demand?:number,rarity?:number,
 *   stability?:string}>}
 */
export function parseSupremeText(text) {
  /** @type {Array<any>} */
  const rows = [];
  const lines = text.split(/\r?\n/);
  const isHeader = (s) =>
    /^(chroma|small|collectible|bulk|dynamic|value|standard|special|victim|premium|limited|event|shop|classic)\s+tier$/i.test(
      s,
    ) ||
    /^\d{4}$/.test(s) || // year separators
    /^(value|stability|demand|rarity|owner|origin|class|exp requirement|change in value)\b/i.test(s);

  for (let i = 0; i < lines.length; i++) {
    const vm = lines[i].match(/^\s*Value\s*[-–]\s*([\d.,KMB]+)\s*(?:\[[^\]]*\])?/i);
    if (!vm) continue;
    const value = parseValueToken(vm[1]);
    if (value === undefined) continue;

    // The item name is the nearest non-empty, non-header line above "Value -".
    let name;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      const cand = lines[j].trim();
      if (cand && !isHeader(cand)) {
        name = cleanName(cand);
        break;
      }
    }
    if (!name) continue;

    // Stability / Demand / Rarity appear on the next few lines (all optional).
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
export function parseSupremeAny(text) {
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
// Reconciliation
// ---------------------------------------------------------------------------

/** Build the source reading object for a parsed row. */
function buildReading(row, source, now, previous) {
  const value = row.value;
  const previousValue = previous?.value;
  const trendPercent =
    previousValue && previousValue > 0
      ? Math.round(((value - previousValue) / previousValue) * 10000) / 100
      : undefined;
  return compact({
    value,
    demand: scale05(row.demand),
    rarityScore: scale05(row.rarity),
    stability: mapStability(row.stability),
    trendPercent,
    previousValue: previousValue !== value ? previousValue : undefined,
    updatedAt: now,
    importedAt: now,
    retrievedAt: now,
    sourceItemId: row.sourceItemId ?? previous?.sourceItemId,
    adapterVersion: source === "supreme" ? SUPREME_ADAPTER_VERSION : SYNC_ADAPTER_VERSION,
    extractionMethod: "licensed-export",
    validation: "ok",
  });
}

/** True when a fresh reading differs from the stored one in a meaningful way. */
function readingChanged(prev, next) {
  if (!prev) return true;
  const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) > 1e-9;
  return (
    prev.value !== next.value ||
    near(prev.demand, next.demand) ||
    near(prev.rarityScore, next.rarityScore) ||
    (prev.stability ?? "") !== (next.stability ?? "")
  );
}

/**
 * Reconcile fetched rows for one source against the snapshot items, mutating
 * items in place and returning a change report.
 *
 * @param {{items: any[]}} snapshot
 * @param {any[]} rows
 * @param {"mm2values"|"supreme"} source
 * @param {{now: string, allowNewItems: boolean}} opts
 */
export function reconcile(snapshot, rows, source, opts) {
  const { now, allowNewItems } = opts;
  const items = snapshot.items;

  // Index existing items by display-name slug (the id may carry a collision
  // suffix, so match on the name slug rather than the id).
  /** @type {Map<string, any[]>} */
  const bySlug = new Map();
  const usedIds = new Set();
  for (const item of items) {
    usedIds.add(item.id);
    const key = slugify(item.displayName);
    const bucket = bySlug.get(key);
    if (bucket) bucket.push(item);
    else bySlug.set(key, [item]);
  }

  const report = { source, checked: 0, changed: 0, added: 0, newItems: 0, ambiguous: 0, samples: [] };

  for (const row of rows) {
    report.checked++;
    const key = slugify(row.name);
    const bucket = bySlug.get(key) ?? [];

    /** @type {any} */
    let target;
    if (bucket.length === 1) {
      target = bucket[0];
    } else if (bucket.length > 1) {
      target =
        (row.sourceItemId &&
          bucket.find((it) => it.values?.[source]?.sourceItemId === row.sourceItemId)) ||
        bucket.find((it) => it.displayName.toLowerCase() === row.name.toLowerCase());
      if (!target) {
        report.ambiguous++;
        continue;
      }
    }

    if (target) {
      const prev = target.values?.[source];
      const next = buildReading(row, source, now, prev);
      if (readingChanged(prev, next)) {
        target.values = target.values ?? {};
        target.values[source] = next;
        if (prev) {
          report.changed++;
          if (report.samples.length < 200) {
            report.samples.push({
              id: target.id,
              name: target.displayName,
              from: prev.value,
              to: next.value,
            });
          }
        } else {
          report.added++;
        }
      }
      continue;
    }

    // No matching item. Only mm2values (which carries category/rarity) may add
    // brand-new items; Supreme rows without a home are reported, not invented.
    if (!allowNewItems) {
      report.ambiguous++;
      continue;
    }

    let id = key;
    let n = 2;
    while (usedIds.has(id)) id = `${key}-${n++}`;
    usedIds.add(id);
    const newItem = compact({
      id,
      displayName: row.name,
      aliases: [],
      category: mapCategory(row.category),
      rarity: mapRarity(row.category),
      chroma: row.category === "chroma",
      verified: true,
      values: { [source]: buildReading(row, source, now, undefined) },
    });
    items.push(newItem);
    bySlug.set(key, [newItem]);
    report.newItems++;
  }

  return report;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMm2Rows() {
  /** @type {any[]} */
  const rows = [];
  for (const { param, category } of MM2_CATEGORIES) {
    const html = await fetchText(`${MM2_BASE}/?p=${param}`);
    const parsed = parseMm2Html(html, category);
    rows.push(...parsed);
    // eslint-disable-next-line no-console
    console.log(`  mm2values/${param}: ${parsed.length} items`);
  }
  return rows;
}

async function fetchSupremeRows() {
  // Preferred, always-available path: page(s) the user saved/exported from their
  // own browser session (SupremeValues is behind bot protection, so we never
  // fetch it programmatically). Accepts a single file, a comma-separated list,
  // or a directory of .html/.json exports. Set SUPREME_VALUES_FILE or pass
  // --supreme-file=path[,path2,...].
  const fileArg = process.env.SUPREME_VALUES_FILE ?? supremeFileArg;
  if (fileArg) {
    const files = resolveSupremeFiles(fileArg);
    if (files.length === 0) throw new Error(`No .html/.json/.txt files found for: ${fileArg}`);
    /** @type {Map<string, any>} */
    const byName = new Map();
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const rows = parseSupremeAny(text);
      // eslint-disable-next-line no-console
      console.log(`  supreme file ${f.split(/[\\/]/).pop()}: ${rows.length} items`);
      // Later files win, and duplicate names across category pages collapse.
      for (const row of rows) byName.set(slugify(row.name), row);
    }
    return [...byName.values()];
  }

  // Optional endpoint the user is permitted to read (JSON or rendered HTML).
  const url = process.env.SUPREME_VALUES_URL;
  if (!url) return null;
  const text = await fetchText(url);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseSupremePayload(JSON.parse(text));
  }
  const rows = parseSupremeHtml(text);
  if (rows.length === 0) {
    throw new Error(
      `SUPREME_VALUES_URL returned no parseable items (got ${text.length} bytes; ` +
        `the site's bot protection likely served a challenge page instead of data)`,
    );
  }
  return rows;
}

/** Expand a --supreme-file argument into a concrete list of files. */
function resolveSupremeFiles(arg) {
  /** @type {string[]} */
  const out = [];
  for (const part of arg.split(",").map((s) => s.trim()).filter(Boolean)) {
    const p = resolve(process.cwd(), part);
    const stat = statSync(p, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      for (const name of readdirSync(p)) {
        if (/\.(html?|json|txt)$/i.test(name)) out.push(resolve(p, name));
      }
    } else if (stat?.isFile()) {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, sources: null, limit: 25, supremeFile: null };
  for (const a of argv) {
    if (a === "--dry-run" || a === "-n") args.dryRun = true;
    else if (a.startsWith("--source=")) args.sources = a.slice(9).split(",").map((s) => s.trim());
    else if (a.startsWith("--limit=")) args.limit = Number.parseInt(a.slice(8), 10) || 25;
    else if (a.startsWith("--supreme-file=")) args.supremeFile = a.slice(15).trim();
  }
  return args;
}

/** Set from CLI args so fetchSupremeRows can read a user-saved page. */
let supremeFileArg = null;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  supremeFileArg = args.supremeFile;
  const wanted = new Set(args.sources ?? ["mm2values", "supreme"]);
  const now = new Date().toISOString();

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const before = JSON.stringify(snapshot);

  const reports = [];
  let anySourceSucceeded = false;

  if (wanted.has("mm2values")) {
    // eslint-disable-next-line no-console
    console.log("Fetching mm2values.com …");
    const rows = await fetchMm2Rows();
    reports.push(reconcile(snapshot, rows, "mm2values", { now, allowNewItems: true }));
    anySourceSucceeded = true;
  }

  if (wanted.has("supreme")) {
    // eslint-disable-next-line no-console
    console.log("Fetching Supreme Values …");
    try {
      const rows = await fetchSupremeRows();
      if (rows === null) {
        // eslint-disable-next-line no-console
        console.log(
          "  supreme: skipped (save the page and pass --supreme-file=path, " +
            "or set SUPREME_VALUES_URL)",
        );
      } else {
        reports.push(reconcile(snapshot, rows, "supreme", { now, allowNewItems: false }));
        anySourceSucceeded = true;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`  supreme: failed — ${err instanceof Error ? err.message : String(err)}`);
      if (args.sources && args.sources.includes("supreme") && !wanted.has("mm2values")) {
        process.exitCode = 1;
        return;
      }
    }
  }

  if (!anySourceSucceeded) {
    // eslint-disable-next-line no-console
    console.error("No sources were available to sync.");
    process.exitCode = 1;
    return;
  }

  // Keep the `sources` list in sync with which sources now have readings.
  const activeSources = new Set(snapshot.sources ?? []);
  for (const r of reports) {
    if (r.changed + r.added + r.newItems > 0) activeSources.add(r.source);
  }
  snapshot.sources = [...activeSources];

  const totalChanges = reports.reduce((n, r) => n + r.changed + r.added + r.newItems, 0);

  // eslint-disable-next-line no-console
  console.log("\nSummary");
  for (const r of reports) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${r.source}: checked ${r.checked}, changed ${r.changed}, ` +
        `new readings ${r.added}, new items ${r.newItems}, unmatched ${r.ambiguous}`,
    );
    for (const s of r.samples.slice(0, args.limit)) {
      // eslint-disable-next-line no-console
      console.log(`    ~ ${s.name}: ${s.from} → ${s.to}`);
    }
  }

  if (totalChanges === 0) {
    // eslint-disable-next-line no-console
    console.log("\nUp to date — no value changes found.");
    return;
  }

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(`\nDry run: ${totalChanges} change(s) detected, snapshot not written.`);
    return;
  }

  snapshot.revision = (snapshot.revision ?? 0) + 1;
  snapshot.generatedAt = now;
  const after = JSON.stringify(snapshot) + "\n";
  if (after.trimEnd() === before) {
    // eslint-disable-next-line no-console
    console.log("\nNo net change after reconcile — snapshot left untouched.");
    return;
  }
  writeFileSync(SNAPSHOT_PATH, after, "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `\nWrote ${totalChanges} change(s) → ${SNAPSHOT_PATH} (revision ${snapshot.revision}).`,
  );
}

// Only run the CLI when executed directly, so tests can import the helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
  });
}
