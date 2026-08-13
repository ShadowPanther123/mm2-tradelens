// @ts-check
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "apps", "desktop", "dist");
const html = readFileSync(join(dist, "index.html"), "utf8");
const mainAsset = html.match(/<script[^>]+src="\/?(assets\/index-[^"]+\.js)"/)?.[1];
if (!mainAsset) throw new Error("Could not locate the main desktop script in dist/index.html");

const mainBytes = statSync(join(dist, mainAsset)).size;
const maximumMainBytes = 150 * 1024;
if (mainBytes > maximumMainBytes) {
  throw new Error(`Main desktop bundle is ${mainBytes} bytes; maximum is ${maximumMainBytes}`);
}

for (const file of ["catalogue.json", "history.json"]) {
  const path = join(dist, "data", file);
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`Missing separately loaded desktop data: data/${file}`);
  }
}

console.log(`Desktop main bundle: ${mainBytes} bytes; catalogue/history are separate.`);
