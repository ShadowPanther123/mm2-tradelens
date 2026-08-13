// @ts-check
/** Reconcile icon-map hashes with the locally bundled, normalized icon files. */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const iconMapPath = resolve(here, "../data/icon-map.json");
const iconDir = resolve(here, "../../../apps/desktop/public/icons/items");

const map = JSON.parse(readFileSync(iconMapPath, "utf8"));
let normalized = 0;
for (const entry of map) {
  const path = join(iconDir, entry.image.split("/").at(-1));
  if (!existsSync(path)) throw new Error(`Missing bundled icon: ${entry.image}`);
  const buffer = readFileSync(path);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const bytes = statSync(path).size;
  if (entry.sha256 === sha256 && entry.bytes === bytes) continue;
  entry.sourceSha256 ??= entry.sha256;
  entry.sourceBytes ??= entry.bytes;
  entry.sha256 = sha256;
  entry.bytes = bytes;
  normalized++;
}
writeFileSync(iconMapPath, JSON.stringify(map, null, 2) + "\n", "utf8");
console.log(`Reconciled ${normalized} normalized bundled icons.`);
