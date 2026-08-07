import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

/** Bundle the service (with its workspace deps) into a single Node script. */
const options = {
  entryPoints: [resolve(root, "src/server.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: resolve(root, "dist/server.js"),
  sourcemap: true,
  // Keep Node built-ins external; everything else is bundled.
  packages: "bundle",
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching values-api… output in dist/server.js");
} else {
  await build(options);
  console.log("Built values-api into dist/server.js");
}
