import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(root, "src/updater.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: resolve(root, "dist/updater.js"),
  sourcemap: true,
  packages: "bundle",
  logLevel: "info",
});
console.log("Built updater into dist/updater.js");
