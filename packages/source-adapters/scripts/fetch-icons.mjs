// @ts-check
/**
 * Download the bundled per-item icons referenced by the generated icon map.
 *
 * Input : packages/source-adapters/data/icon-map.json  (from generate-mm2values)
 * Output: apps/desktop/public/icons/items/<id>.<detected-format>
 *
 * Each entry carries the licensed source URL plus the expected sha256 and byte
 * size from the manifest, so every download is content-verified before it is
 * written. Icons are addressed by the canonical `icons/items/<id>.png` path the
 * app already resolves — the external URL is never stored on an item.
 *
 * Run: node packages/source-adapters/scripts/fetch-icons.mjs
 * Skips files already present and valid; pass --force to re-download.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ICON_MAP_PATH = resolve(here, "../data/icon-map.json");
const OUT_DIR = resolve(here, "../../../apps/desktop/public/icons/items");

const FORCE = process.argv.includes("--force");
/** Polite concurrency so we don't hammer the source. */
const CONCURRENCY = 6;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function detectedExtension(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    return "webp";
  return null;
}

/** True when the on-disk file already matches the expected hash/size. */
function alreadyValid(path, entry) {
  if (FORCE || !existsSync(path)) return false;
  try {
    if (entry.bytes && statSync(path).size !== entry.bytes) return false;
    if (entry.sha256) return sha256(readFileSync(path)) === entry.sha256;
    return true;
  } catch {
    return false;
  }
}

async function download(entry) {
  const filename = entry.image.split("/").pop();
  const path = join(OUT_DIR, filename);
  if (alreadyValid(path, entry)) {
    const actual = detectedExtension(readFileSync(path));
    const declared = filename.split(".").at(-1)?.toLowerCase();
    if (actual && actual === declared) return { id: entry.id, status: "skipped" };
    return { id: entry.id, status: "error", detail: `content is ${actual ?? "unknown"}, filename is .${declared}` };
  }

  const res = await fetch(entry.sourceUrl);
  if (!res.ok) {
    return { id: entry.id, status: "error", detail: `HTTP ${res.status}` };
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const actual = detectedExtension(buffer);
  const declared = filename.split(".").at(-1)?.toLowerCase();
  if (!actual || actual !== declared) {
    return {
      id: entry.id,
      status: "error",
      detail: `downloaded content is ${actual ?? "unknown"}, manifest filename is .${declared}`,
    };
  }

  const sourceBytes = entry.sourceBytes ?? entry.bytes;
  const sourceSha256 = entry.sourceSha256 ?? entry.sha256;
  if (sourceBytes && buffer.length !== sourceBytes) {
    return {
      id: entry.id,
      status: "error",
      detail: `source size ${buffer.length} != expected ${sourceBytes}`,
    };
  }
  if (sourceSha256 && sha256(buffer) !== sourceSha256) {
    return { id: entry.id, status: "error", detail: "source sha256 mismatch" };
  }
  if (
    (entry.bytes && buffer.length !== entry.bytes) ||
    (entry.sha256 && sha256(buffer) !== entry.sha256)
  ) {
    return {
      id: entry.id,
      status: "error",
      detail: "bundled icon is a normalized derivative and must be restored from the repository",
    };
  }

  writeFileSync(path, buffer);
  return { id: entry.id, status: "downloaded" };
}

/** Run tasks with a small fixed concurrency, preserving all results. */
async function runPool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  async function pull() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, pull));
  return results;
}

async function main() {
  const map = JSON.parse(readFileSync(ICON_MAP_PATH, "utf8"));
  mkdirSync(OUT_DIR, { recursive: true });

  const results = await runPool(map, download, CONCURRENCY);
  const counts = { downloaded: 0, skipped: 0, error: 0 };
  const errors = [];
  for (const r of results) {
    counts[r.status]++;
    if (r.status === "error") errors.push(`${r.id}: ${r.detail}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Icons: ${counts.downloaded} downloaded, ${counts.skipped} already present, ` +
      `${counts.error} failed → ${OUT_DIR}`,
  );
  if (errors.length) {
    // eslint-disable-next-line no-console
    console.error("Failures:\n  " + errors.slice(0, 20).join("\n  "));
    process.exitCode = 1;
  }
}

main();
