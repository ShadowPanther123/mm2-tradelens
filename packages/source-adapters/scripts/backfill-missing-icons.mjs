// @ts-check
/** Download and register every icon missing from the licensed MM2Values export. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = resolve(here, "../data/mm2values.csv");
const manifestPath = resolve(here, "../data/icons-manifest.csv");
const iconMapPath = resolve(here, "../data/icon-map.json");
const snapshotPath = resolve(here, "../src/mm2values-snapshot.json");
const iconDir = resolve(here, "../../../apps/desktop/public/icons/items");

function imageExtension(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new Error("Unsupported icon format");
}
const maxBytes = 72 * 1024;
const concurrency = 6;

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

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isRasterImage(buffer) {
  const png =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("ascii") === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const webp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const gif =
    buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  return png || webp || jpeg || gif;
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      headers: { accept: "image/png,image/*;q=0.8", "user-agent": "MM2-TradeLens/0.1 icon importer" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > maxBytes) {
      throw new Error(`invalid icon size ${buffer.length} for ${url}`);
    }
    if (!isRasterImage(buffer)) throw new Error(`source is not a supported image for ${url}`);
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, worker) {
  let next = 0;
  const output = new Array(items.length);
  async function pull() {
    while (next < items.length) {
      const index = next++;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, pull));
  return output;
}

async function main() {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const csvRows = parseCsv(readFileSync(csvPath, "utf8"));
  const csvHeader = csvRows.shift();
  if (!csvHeader) throw new Error("MM2Values CSV is empty");
  const col = Object.fromEntries(csvHeader.map((name, index) => [name.trim(), index]));
  const sourceById = new Map();
  for (const row of csvRows) {
    const sourceItemId = (row[col.source_item_id] ?? "").trim();
    const sourceUrl = (row[col.image_url] ?? "").trim();
    if (!sourceItemId || !sourceUrl) continue;
    sourceById.set(sourceItemId, {
      sourceUrl,
      sourceCategory: (row[col.source_category] ?? "misc").trim().toLowerCase(),
    });
  }

  const targets = snapshot.items
    .filter((item) => !item.image)
    .map((item) => {
      const sourceItemId = String(item.values?.mm2values?.sourceItemId ?? "");
      const source = sourceById.get(sourceItemId);
      if (!source) throw new Error(`No licensed icon URL for ${item.id}`);
      return { item, ...source };
    });

  mkdirSync(iconDir, { recursive: true });
  const iconData = await runPool(targets, async (target) => {
    const existing = ["png", "webp", "jpg"]
      .map((extension) => join(iconDir, `${target.item.id}.${extension}`))
      .find((path) => existsSync(path));
    const buffer = existing ? readFileSync(existing) : await download(target.sourceUrl);
    const extension = imageExtension(buffer);
    target.image = `icons/items/${target.item.id}.${extension}`;
    const path = join(iconDir, `${target.item.id}.${extension}`);
    if (!existsSync(path)) writeFileSync(path, buffer);
    if (!isRasterImage(buffer) || buffer.length === 0 || buffer.length > maxBytes) {
      throw new Error(`Invalid local icon for ${target.item.id}`);
    }
    return { ...target, sha256: sha256(buffer), bytes: statSync(path).size };
  });

  const iconMap = JSON.parse(readFileSync(iconMapPath, "utf8"));
  const mapById = new Map(iconMap.map((entry) => [entry.id, entry]));
  const manifestRows = parseCsv(readFileSync(manifestPath, "utf8"));
  const manifestHeader = manifestRows.shift();
  if (!manifestHeader) throw new Error("Icon manifest is empty");
  const manifestCol = Object.fromEntries(manifestHeader.map((name, index) => [name.trim(), index]));
  const manifestByUrl = new Map(
    manifestRows
      .filter((row) => row.length > 1)
      .map((row) => [(row[manifestCol.source_url] ?? "").trim().toLowerCase(), row]),
  );

  for (const entry of iconData) {
    mapById.set(entry.item.id, {
      id: entry.item.id,
      image: entry.image,
      sourceUrl: entry.sourceUrl,
      sha256: entry.sha256,
      bytes: entry.bytes,
    });
    manifestByUrl.set(entry.sourceUrl.toLowerCase(), [
      entry.item.displayName,
      entry.sourceCategory,
      `icons/${entry.sourceCategory}/${entry.item.id}.${entry.image.split(".").at(-1)}`,
      entry.sourceUrl,
      entry.sha256,
      String(entry.bytes),
    ]);
    entry.item.image = entry.image;
  }

  const orderedMap = snapshot.items.map((item) => mapById.get(item.id)).filter(Boolean);
  const orderedManifest = [...manifestByUrl.values()].sort((a, b) => {
    const category = String(a[1]).localeCompare(String(b[1]));
    return category || String(a[0]).localeCompare(String(b[0]));
  });
  writeFileSync(iconMapPath, JSON.stringify(orderedMap, null, 2) + "\n", "utf8");
  writeFileSync(
    manifestPath,
    [manifestHeader, ...orderedManifest].map((row) => row.map(csv).join(",")).join("\n") + "\n",
    "utf8",
  );
  if (iconData.length > 0) {
    snapshot.revision = (snapshot.revision ?? 0) + 1;
    snapshot.generatedAt = new Date().toISOString();
    writeFileSync(snapshotPath, JSON.stringify(snapshot) + "\n", "utf8");
  }
  console.log(`Registered ${iconData.length} previously missing icons.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
