import { build, context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

mkdirSync(outdir, { recursive: true });

/** Copy static popup assets and manifest into the build output. */
function copyStatic() {
  cpSync(resolve(root, "public"), outdir, { recursive: true });
}

const options = {
  entryPoints: [resolve(root, "src/popup.ts"), resolve(root, "src/background.ts")],
  bundle: true,
  format: "esm",
  target: "es2021",
  outdir,
  sourcemap: true,
  logLevel: "info",
};

copyStatic();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching browser-extension… output in dist/");
} else {
  await build(options);
  console.log("Built browser-extension into dist/");
}
