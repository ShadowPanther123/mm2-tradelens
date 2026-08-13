// @ts-check
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = join(root, "packages", "source-adapters", "src", "mm2values-snapshot.json");
const outputDir = join(root, "apps", "desktop", "public", "data");

export function splitSnapshot(snapshot) {
  const catalogue = structuredClone(snapshot);
  const histories = {};
  for (const item of catalogue.items) {
    for (const [source, reading] of Object.entries(item.values ?? {})) {
      if (!Array.isArray(reading.history) || reading.history.length === 0) continue;
      histories[item.id] ??= {};
      histories[item.id][source] = reading.history;
      delete reading.history;
    }
  }
  return {
    catalogue,
    history: {
      schemaVersion: snapshot.schemaVersion,
      revision: snapshot.revision,
      generatedAt: snapshot.generatedAt,
      items: histories,
    },
  };
}

function main() {
  const snapshot = JSON.parse(readFileSync(sourcePath, "utf8"));
  const { catalogue, history } = splitSnapshot(snapshot);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "catalogue.json"), JSON.stringify(catalogue));
  writeFileSync(join(outputDir, "history.json"), JSON.stringify(history));
  console.log(
    `Prepared desktop data revision ${snapshot.revision}: ${catalogue.items.length} catalogue items, ` +
      `${Object.keys(history.items).length} history series.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
