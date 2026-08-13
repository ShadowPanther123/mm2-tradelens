// @ts-check
/** Apply deterministic type, year, and duplicate-name metadata to the snapshot. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanName,
  deriveCatalogueMetadata,
  disambiguateCatalogueRows,
} from "./catalogue-metadata.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = resolve(here, "../data/mm2values.csv");
const snapshotPath = resolve(here, "../src/mm2values-snapshot.json");

function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field || record.length) {
    record.push(field);
    rows.push(record);
  }
  return rows;
}

const sourceRows = parseCsv(readFileSync(csvPath, "utf8"));
const header = sourceRows.shift();
if (!header) throw new Error("MM2Values CSV is empty");
const col = Object.fromEntries(header.map((name, index) => [name.trim(), index]));
const bySourceId = new Map();
for (const row of sourceRows) {
  const sourceItemId = (row[col.source_item_id] ?? "").trim();
  if (!sourceItemId) continue;
  bySourceId.set(sourceItemId, {
    sourceItemId,
    name: (row[col.name] ?? "").trim(),
    sourceCategory: (row[col.source_category] ?? "").trim(),
    imageUrl: (row[col.image_url] ?? "").trim(),
    wikiUrl: (row[col.wiki_url] ?? "").trim(),
    origin: (row[col.origin] ?? "").trim(),
  });
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const before = JSON.stringify(snapshot);
const prepared = snapshot.items.map((item) => {
  const sourceItemId = String(item.values?.mm2values?.sourceItemId ?? "");
  const source = bySourceId.get(sourceItemId);
  if (!source) throw new Error(`No licensed metadata row for ${item.id} (${sourceItemId})`);
  const metadata = deriveCatalogueMetadata(source);
  return {
    item,
    sourceItemId,
    displayName: cleanName(source.name),
    category: metadata.category,
    year: metadata.year,
    rarity: item.rarity,
    origin: source.origin || undefined,
  };
});

disambiguateCatalogueRows(prepared);
for (const row of prepared) {
  row.item.displayName = row.catalogueName;
  row.item.category = row.category;
  if (row.year) row.item.year = row.year;
  else delete row.item.year;
  if (row.origin) row.item.origin = row.origin;
}

if (JSON.stringify(snapshot) !== before) {
  snapshot.revision = (snapshot.revision ?? 0) + 1;
  snapshot.generatedAt = new Date().toISOString();
  writeFileSync(snapshotPath, JSON.stringify(snapshot) + "\n", "utf8");
}

const counts = prepared.reduce(
  (out, row) => {
    out[row.category] = (out[row.category] ?? 0) + 1;
    if (row.year) out.withYear++;
    if (row.catalogueName !== row.displayName) out.disambiguated++;
    return out;
  },
  { knife: 0, gun: 0, pet: 0, bundle: 0, other: 0, withYear: 0, disambiguated: 0 },
);
console.log(`Enriched ${prepared.length} items: ${JSON.stringify(counts)}.`);
