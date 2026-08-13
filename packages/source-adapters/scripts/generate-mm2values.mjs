// @ts-check
/**
 * Generate the bundled MM2Values snapshot from a licensed CSV export.
 *
 * Input : packages/source-adapters/data/mm2values.csv
 * Output: packages/source-adapters/src/mm2values-snapshot.json
 *
 * The CSV is a per-item export with the columns declared in its header row.
 * This script normalises each row into the canonical MM2 TradeLens item shape
 * (see @tradelens/item-schema) using only fields present in the source — no
 * values are invented. Fields the export does not carry (weapon type, release
 * year, aliases) are simply left unset.
 *
 * Run: node packages/source-adapters/scripts/generate-mm2values.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  cleanName,
  deriveCatalogueMetadata,
  disambiguateCatalogueRows,
  slugify,
} from "./catalogue-metadata.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(here, "../data/mm2values.csv");
const OUT_PATH = resolve(here, "../src/mm2values-snapshot.json");
const ICON_MANIFEST_PATH = resolve(here, "../data/icons-manifest.csv");
const ICON_MAP_PATH = resolve(here, "../data/icon-map.json");

/** Public-root-relative directory the desktop app serves per-item icons from. */
const ITEM_ICON_DIR = "icons/items";

const SOURCE = "mm2values";
const ADAPTER_VERSION = "mm2values-import-1.0.0";

/** Parse RFC-4180-ish CSV (quoted fields may contain commas and doubled quotes). */
function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  return rows;
}

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

function mapRarity(category) {
  return RARITY_BY_CATEGORY[category] ?? "misc";
}

/** Rescale a source 0–11 rating onto the schema's 0–5 range. */
function scale05(raw) {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  const scaled = Math.max(0, Math.min(5, (n * 5) / 11));
  return Math.round(scaled * 100) / 100;
}

function mapStability(raw) {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "" || t === "n/a") return undefined;
  if (t.includes("volatile")) return "volatile";
  // Labels that describe a value actively on the move.
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
  // "stable", "doing well", "overpaid for", "underpaid for": a value sitting
  // steady against its worth rather than moving.
  return "stable";
}

/** Drop undefined-valued keys so the emitted JSON stays compact. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Normalise a source image URL for matching (trim + lowercase). */
function normaliseUrl(url) {
  return (url ?? "").trim().toLowerCase();
}

/**
 * Load the bundled icon manifest, keyed by normalised source URL. The manifest
 * is a licensed export listing each downloaded icon's source URL, content hash
 * and size, and is the authority for *which* items have an icon available.
 * Returns an empty map (with a warning) when the manifest is absent so the
 * snapshot can still be generated without icons.
 */
function loadIconManifest() {
  let text;
  try {
    text = readFileSync(ICON_MANIFEST_PATH, "utf8");
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`No icon manifest at ${ICON_MANIFEST_PATH}; icons skipped.`);
    return new Map();
  }
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) return new Map();
  const col = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
  const byUrl = new Map();
  for (const record of rows) {
    if (record.length === 1 && record[0].trim() === "") continue;
    const url = normaliseUrl(record[col.source_url]);
    if (!url) continue;
    byUrl.set(url, {
      image: (record[col.file] ?? "").trim() || undefined,
      sha256: (record[col.sha256] ?? "").trim() || undefined,
      bytes: Number.parseInt((record[col.bytes] ?? "").trim(), 10) || undefined,
    });
  }
  return byUrl;
}

/** Preserve already-registered local icons when regenerating the snapshot. */
function loadExistingIconMap() {
  try {
    const entries = JSON.parse(readFileSync(ICON_MAP_PATH, "utf8"));
    return new Map(entries.map((entry) => [entry.id, entry]));
  } catch {
    return new Map();
  }
}

function main() {
  const text = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new Error("CSV is empty");
  const col = Object.fromEntries(header.map((name, i) => [name.trim(), i]));

  const required = [
    "source",
    "source_category",
    "name",
    "value",
    "demand",
    "rarity",
    "stability",
    "source_item_id",
    "fetched_at",
  ];
  for (const key of required) {
    if (col[key] === undefined) throw new Error(`missing column: ${key}`);
  }

  // First pass: build normalised rows and detect slug collisions.
  const prepared = [];
  const baseCount = new Map();
  let skipped = 0;

  for (const record of rows) {
    if (record.length === 1 && record[0].trim() === "") continue;
    const get = (key) => (record[col[key]] ?? "").trim();

    const displayName = cleanName(get("name"));
    const base = slugify(displayName);
    const value = Number.parseFloat(get("value"));
    const isControlLabel = /^(add|choose|select)\s+(item|weapon)$/i.test(displayName);
    if (!displayName || !base || isControlLabel || !Number.isFinite(value) || value < 0) {
      skipped++;
      continue;
    }

    const sourceCategory = get("source_category").toLowerCase();
    const updatedAt = new Date(get("fetched_at")).toISOString();
    const metadata = deriveCatalogueMetadata({
      displayName,
      sourceCategory,
      imageUrl: get("image_url"),
      wikiUrl: get("wiki_url"),
    });

    prepared.push({
      base,
      displayName,
      value,
      sourceCategory,
      category: metadata.category,
      rarity: mapRarity(sourceCategory),
      year: metadata.year,
      origin: get("origin") || undefined,
      chroma: sourceCategory === "chroma",
      demand: scale05(get("demand")),
      rarityScore: scale05(get("rarity")),
      stability: mapStability(get("stability")),
      sourceItemId: get("source_item_id") || undefined,
      imageUrl: get("image_url") || undefined,
      updatedAt,
    });
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
  }

  disambiguateCatalogueRows(prepared);

  const generatedAt = new Date().toISOString();

  const iconManifest = loadIconManifest();
  const existingIcons = loadExistingIconMap();

  // Second pass: assign unique ids and assemble items.
  const usedIds = new Set();
  const items = [];
  const iconMap = [];
  for (const p of prepared) {
    let id = p.base;
    if ((baseCount.get(p.base) ?? 0) > 1) {
      id = p.sourceItemId ? `${p.base}-${slugify(p.sourceItemId)}` : p.base;
    }
    let unique = id;
    let n = 2;
    while (usedIds.has(unique)) unique = `${id}-${n++}`;
    usedIds.add(unique);

    const sourceValue = compact({
      value: p.value,
      demand: p.demand,
      rarityScore: p.rarityScore,
      stability: p.stability,
      updatedAt: p.updatedAt,
      importedAt: generatedAt,
      retrievedAt: p.updatedAt,
      sourceItemId: p.sourceItemId,
      adapterVersion: ADAPTER_VERSION,
      extractionMethod: "licensed-export",
      validation: "ok",
    });

    // Wire the canonical local icon when the manifest has one for this item's
    // source image. We never store the external URL on the item (no hotlinking)
    // — the icon is addressed by the bundled `icons/items/<id>.png` convention.
    const manifestIcon = p.imageUrl ? iconManifest.get(normaliseUrl(p.imageUrl)) : undefined;
    const existingIcon = existingIcons.get(unique);
    const icon = existingIcon ?? manifestIcon;
    const format = icon?.image?.split(".").at(-1)?.toLowerCase() ?? "png";
    const image = icon ? `${ITEM_ICON_DIR}/${unique}.${format}` : undefined;
    if (icon) {
      iconMap.push(
        compact({
          id: unique,
          image,
          sourceUrl: p.imageUrl ?? existingIcon?.sourceUrl,
          sha256: icon.sha256,
          bytes: icon.bytes,
        }),
      );
    }

    items.push(
      compact({
        id: unique,
        displayName: p.catalogueName,
        aliases: [],
        category: p.category,
        rarity: p.rarity,
        origin: p.origin,
        year: p.year,
        chroma: p.chroma,
        image,
        verified: true,
        values: { [SOURCE]: sourceValue },
      }),
    );
  }

  let previousRevision = 0;
  if (existsSync(OUT_PATH)) {
    try {
      const previous = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      if (Number.isInteger(previous.revision) && previous.revision >= 0) {
        previousRevision = previous.revision;
      }
    } catch {
      throw new Error(`existing snapshot is not valid JSON: ${OUT_PATH}`);
    }
  }

  const snapshot = {
    schemaVersion: 1,
    revision: previousRevision + 1,
    generatedAt,
    sources: [SOURCE],
    items,
  };

  writeFileSync(OUT_PATH, JSON.stringify(snapshot) + "\n", "utf8");
  writeFileSync(ICON_MAP_PATH, JSON.stringify(iconMap, null, 2) + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${items.length} items (skipped ${skipped}) to ${OUT_PATH}\n` +
      `Linked ${iconMap.length} item icons (of ${iconManifest.size} in manifest) ` +
      `to ${ICON_MAP_PATH}\n` +
      `generatedAt=${generatedAt}`,
  );
}

main();
