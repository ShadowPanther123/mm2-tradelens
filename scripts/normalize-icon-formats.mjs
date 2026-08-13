// @ts-check
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const iconDir = join(root, "apps", "desktop", "public", "icons", "items");
const snapshotPath = join(root, "packages", "source-adapters", "src", "mm2values-snapshot.json");
const mapPath = join(root, "packages", "source-adapters", "data", "icon-map.json");
const manifestPath = join(root, "packages", "source-adapters", "data", "icons-manifest.csv");

export function detectedExtension(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return null;
}

function updateReference(value, replacements) {
  return typeof value === "string" ? (replacements.get(value.replaceAll("\\", "/")) ?? value) : value;
}

function main() {
  const replacements = new Map();
  const moves = [];
  for (const filename of readdirSync(iconDir)) {
    const from = join(iconDir, filename);
    const actual = detectedExtension(readFileSync(from));
    if (!actual) throw new Error(`Unrecognised icon content: ${filename}`);
    const declared = extname(filename).slice(1).toLowerCase();
    if (declared === actual || (declared === "jpeg" && actual === "jpg")) continue;
    const stem = filename.slice(0, filename.length - extname(filename).length);
    const nextName = `${stem}.${actual}`;
    const to = join(iconDir, nextName);
    if (existsSync(to)) throw new Error(`Refusing to overwrite existing icon: ${nextName}`);
    moves.push({ from, to });
    replacements.set(`icons/items/${filename}`, `icons/items/${nextName}`);
  }

  for (const move of moves) renameSync(move.from, move.to);

  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  for (const item of snapshot.items) item.image = updateReference(item.image, replacements);
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);

  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  for (const entry of map) entry.image = updateReference(entry.image, replacements);
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);

  let manifest = readFileSync(manifestPath, "utf8");
  for (const [from, to] of replacements) {
    const filename = from.split("/").at(-1);
    const replacement = to.split("/").at(-1);
    if (filename && replacement) manifest = manifest.replaceAll(`/${filename}`, `/${replacement}`);
  }
  writeFileSync(manifestPath, manifest);

  console.log(`Normalized ${moves.length} icon filename(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
