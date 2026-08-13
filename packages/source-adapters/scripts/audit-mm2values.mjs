// @ts-check
/** Standalone integrity audit for the bundled catalogue and icon registry. */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(here, "../src/mm2values-snapshot.json");
const iconMapPath = resolve(here, "../data/icon-map.json");
const publicDir = resolve(here, "../../../apps/desktop/public");

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const iconMap = JSON.parse(readFileSync(iconMapPath, "utf8"));
const errors = [];
const ids = new Set();
const names = new Set();
const mapById = new Map(iconMap.map((entry) => [entry.id, entry]));

for (const item of snapshot.items) {
  const name = item.displayName.trim().toLowerCase();
  if (ids.has(item.id)) errors.push(`duplicate id: ${item.id}`);
  if (names.has(name)) errors.push(`duplicate display name: ${item.displayName}`);
  ids.add(item.id);
  names.add(name);
  if (!item.image) {
    errors.push(`missing image reference: ${item.id}`);
    continue;
  }
  const expected = `icons/items/${item.id}.png`;
  if (item.image !== expected) errors.push(`non-canonical image reference: ${item.id}`);
  const entry = mapById.get(item.id);
  if (!entry) {
    errors.push(`missing icon-map entry: ${item.id}`);
    continue;
  }
  const path = resolve(publicDir, item.image);
  if (!existsSync(path)) {
    errors.push(`missing bundled icon: ${item.image}`);
    continue;
  }
  const buffer = readFileSync(path);
  const hash = createHash("sha256").update(buffer).digest("hex");
  if (entry.bytes !== buffer.length || entry.sha256 !== hash) {
    errors.push(`icon metadata mismatch: ${item.id}`);
  }
}

for (const entry of iconMap) {
  if (!ids.has(entry.id)) errors.push(`orphan icon-map entry: ${entry.id}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Catalogue audit clean: ${snapshot.items.length} unique items, ` +
      `${iconMap.length} verified icons, 0 missing assets.`,
  );
}
