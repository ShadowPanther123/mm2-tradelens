#!/usr/bin/env node
// Validates the app's bundled assets:
//  - every icon referenced by tauri.conf.json exists,
//  - the shared missing-icon placeholder exists,
//  - item icons (if any) use an allowed format and stay within the size budget,
//  - flags large files under the desktop public/ folder for compression.
//
// Exits non-zero when a hard requirement is violated so CI/release can gate on it.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const desktop = join(root, "apps", "desktop");
const tauri = join(desktop, "src-tauri");

const ALLOWED_ICON_FORMATS = ["png", "webp", "jpg", "jpeg", "svg"];
const ITEM_ICON_MAX_BYTES = 72 * 1024;
const LARGE_ASSET_BYTES = 512 * 1024;
const PLACEHOLDER = join(desktop, "public", "icons", "placeholder.svg");
const SNAPSHOT_PATH = join(root, "packages", "source-adapters", "src", "mm2values-snapshot.json");
const EXPECTED_LARGE_ASSETS = new Set([
  "public/tessdata/eng.traineddata.gz",
  "public/tesseract/tesseract-core-simd.wasm",
  "public/tesseract/tesseract-core-simd.wasm.js",
  "public/tesseract/tesseract-core.wasm",
  "public/tesseract/tesseract-core.wasm.js",
  "public/data/catalogue.json",
  "public/data/history.json",
]);

const errors = [];
const warnings = [];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}

function detectedRasterFormat(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

// 1. Tauri bundle icons ------------------------------------------------------
const conf = JSON.parse(readFileSync(join(tauri, "tauri.conf.json"), "utf8"));
const bundleIcons = conf?.bundle?.icon ?? [];
if (bundleIcons.length === 0) errors.push("tauri.conf.json declares no bundle icons.");
for (const rel of bundleIcons) {
  const p = join(tauri, rel);
  if (!existsSync(p)) errors.push(`Missing bundle icon: ${rel}`);
}
// Windows installer + taskbar need the .ico specifically.
if (!bundleIcons.some((i) => i.toLowerCase().endsWith(".ico"))) {
  errors.push("No .ico icon in bundle.icon — Windows installer/taskbar icon will be missing.");
}
for (const required of ["icon.ico", "icon.png"]) {
  if (!existsSync(join(tauri, "icons", required))) {
    warnings.push(`Recommended icon not found: icons/${required}`);
  }
}

// 2. Placeholder -------------------------------------------------------------
if (!existsSync(PLACEHOLDER)) {
  errors.push("Missing shared placeholder: apps/desktop/public/icons/placeholder.svg");
}

// Browser-extension manifest icons must exist in the packaged public tree.
const extensionDir = join(root, "apps", "browser-extension");
const extensionManifestPath = join(extensionDir, "public", "manifest.json");
if (existsSync(extensionManifestPath)) {
  const manifest = JSON.parse(readFileSync(extensionManifestPath, "utf8"));
  for (const icon of Object.values(manifest.icons ?? {})) {
    if (typeof icon !== "string" || !existsSync(join(extensionDir, "public", icon))) {
      errors.push(`Missing browser-extension icon: ${String(icon)}`);
    }
  }
}

// 3. Item icons --------------------------------------------------------------
const itemIconDir = join(desktop, "public", "icons", "items");
const seenHashes = new Map();
if (existsSync(itemIconDir)) {
  for (const file of walk(itemIconDir)) {
    const rel = relative(desktop, file);
    const ext = extname(file).slice(1).toLowerCase();
    if (!ALLOWED_ICON_FORMATS.includes(ext)) {
      errors.push(`Item icon uses disallowed format: ${rel}`);
      continue;
    }
    const { size } = statSync(file);
    if (size === 0) errors.push(`Item icon is empty: ${rel}`);
    else if (size > ITEM_ICON_MAX_BYTES)
      errors.push(`Item icon exceeds ${fmtBytes(ITEM_ICON_MAX_BYTES)}: ${rel} (${fmtBytes(size)})`);
    // Duplicate detection by content.
    const buf = readFileSync(file);
    if (ext !== "svg") {
      const actual = detectedRasterFormat(buf);
      const normalizedExt = ext === "jpeg" ? "jpg" : ext;
      if (!actual) errors.push(`Item icon has unrecognised content: ${rel}`);
      else if (actual !== normalizedExt)
        errors.push(`Item icon extension mismatch: ${rel} contains ${actual}`);
    }
    let hash = 0;
    for (let i = 0; i < buf.length; i++) hash = (hash * 31 + buf[i]) >>> 0;
    const key = `${size}:${hash}`;
    if (seenHashes.has(key))
      warnings.push(`Possible duplicate icon: ${rel} == ${seenHashes.get(key)}`);
    else seenHashes.set(key, rel);
  }
}

// 4. Large public assets -----------------------------------------------------
for (const file of walk(join(desktop, "public"))) {
  const { size } = statSync(file);
  const rel = relative(desktop, file).replaceAll("\\", "/");
  if (size > LARGE_ASSET_BYTES && !EXPECTED_LARGE_ASSETS.has(rel)) {
    warnings.push(`Large asset (consider compressing): ${rel} (${fmtBytes(size)})`);
  }
}

// Every legendary item must carry its canonical, bundled icon, and every image
// reference in the snapshot must resolve to a real public asset.
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
for (const item of snapshot.items) {
  if (item.rarity === "legendary" && !item.image) {
    errors.push(`Legendary item has no icon: ${item.id}`);
    continue;
  }
  if (!item.image) continue;
  const imageExt = extname(item.image).slice(1).toLowerCase();
  const canonical = `icons/items/${item.id}.${imageExt}`;
  if (item.image !== canonical || !ALLOWED_ICON_FORMATS.includes(imageExt)) {
    errors.push(`Non-canonical item icon path for ${item.id}: ${item.image}`);
    continue;
  }
  if (!existsSync(join(desktop, "public", item.image))) {
    errors.push(`Snapshot references a missing item icon: ${item.image}`);
  }
}

// Report ---------------------------------------------------------------------
for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);

console.log(`\nAsset check: ${errors.length} error(s), ${warnings.length} warning(s).`);
process.exit(errors.length > 0 ? 1 : 0);
