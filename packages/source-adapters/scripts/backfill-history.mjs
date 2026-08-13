// @ts-check
/** Rebuild rolling value history from every committed bundled snapshot. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const snapshotPath = resolve(here, "../src/mm2values-snapshot.json");
const gitPath = "packages/source-adapters/src/mm2values-snapshot.json";
const maxHistoryPoints = 200;

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function committedSnapshots() {
  const revisions = git("log", "--format=%H", "--reverse", "--", gitPath)
    .split(/\r?\n/)
    .filter(Boolean);
  const snapshots = [];
  for (const revision of revisions) {
    try {
      snapshots.push(JSON.parse(git("show", `${revision}:${gitPath}`)));
    } catch {
      // Ignore commits where the path was not yet a valid snapshot.
    }
  }
  return snapshots.sort(
    (a, b) =>
      Date.parse(a.generatedAt) - Date.parse(b.generatedAt) ||
      (a.revision ?? 0) - (b.revision ?? 0),
  );
}

function sourceKey(item, source) {
  return item.values?.[source]?.sourceItemId;
}

function findHistoricItem(snapshot, currentItem, source) {
  const exact = snapshot.items.find((item) => item.id === currentItem.id);
  if (exact) return exact;
  const key = sourceKey(currentItem, source);
  return key ? snapshot.items.find((item) => sourceKey(item, source) === key) : undefined;
}

function compactSeries(points, currentValue, currentAt) {
  const valid = points
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(Date.parse(point.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const series = [];
  for (const point of valid) {
    const last = series.at(-1);
    if (!last || last.value !== point.value || last.at.slice(0, 10) !== point.at.slice(0, 10))
      series.push(point);
  }
  if (
    series.at(-1)?.value !== currentValue ||
    series.at(-1)?.at.slice(0, 10) !== currentAt.slice(0, 10)
  )
    series.push({ value: currentValue, at: currentAt });
  return series.slice(-maxHistoryPoints);
}

function main() {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const before = JSON.stringify(snapshot);
  const historic = committedSnapshots();
  let readings = 0;
  let deep = 0;

  for (const item of snapshot.items) {
    for (const [source, reading] of Object.entries(item.values ?? {})) {
      const hadHistory = Array.isArray(reading.history) && reading.history.length > 0;
      const observedAt = hadHistory
        ? (reading.retrievedAt ?? reading.history.at(-1)?.at ?? snapshot.generatedAt)
        : snapshot.generatedAt;
      const points = [];
      for (const prior of historic) {
        const historicItem = findHistoricItem(prior, item, source);
        const value = historicItem?.values?.[source]?.value;
        if (typeof value === "number") points.push({ value, at: prior.generatedAt });
      }
      points.push({ value: reading.value, at: observedAt });
      reading.history = compactSeries(points, reading.value, observedAt);
      if (!hadHistory) reading.retrievedAt = observedAt;
      readings++;
      if (reading.history.length > 1) deep++;
    }
  }

  if (JSON.stringify(snapshot) === before) {
    console.log("History is already complete.");
    return;
  }

  snapshot.revision = (snapshot.revision ?? 0) + 1;
  snapshot.generatedAt = new Date().toISOString();
  writeFileSync(snapshotPath, JSON.stringify(snapshot) + "\n", "utf8");
  console.log(
    `Backfilled ${readings} readings (${deep} with multiple snapshots) at revision ${snapshot.revision}.`,
  );
}

main();
