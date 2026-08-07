// @ts-check
/**
 * Publish the freshly-synced values snapshot to an installed MM2 TradeLens so
 * the in-app "Check for updates" button picks them up — no rebuild, no network
 * service.
 *
 * How it works: the desktop app reads an optional `values-snapshot.json` from
 * its own per-user app data directory. This script copies the bundled snapshot
 * (packages/source-adapters/src/mm2values-snapshot.json — the file a value sync
 * writes) into that directory. On the next "Check for updates" the app validates
 * it, sees a newer revision, and adopts it.
 *
 * Typical flow:
 *   npm run sync:values --workspace @tradelens/source-adapters   # refresh data
 *   npm run publish:local                                        # push to app
 *   # then press "Check for updates" in the app
 *
 * Usage:
 *   node scripts/publish-local.mjs [--snapshot <path>] [--target <dir>] [--dry-run]
 *
 * Defaults:
 *   --snapshot  packages/source-adapters/src/mm2values-snapshot.json
 *   --target    the app data dir for identifier "com.tradelens.mm2"
 *               (Windows: %APPDATA%\com.tradelens.mm2)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir, platform } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");

/** Tauri bundle identifier from apps/desktop/src-tauri/tauri.conf.json. */
const APP_IDENTIFIER = "com.tradelens.mm2";
const EXTERNAL_SNAPSHOT_FILE = "values-snapshot.json";
const DEFAULT_SNAPSHOT = resolve(
  REPO_ROOT,
  "packages/source-adapters/src/mm2values-snapshot.json",
);

function parseArgs(argv) {
  const args = { snapshot: DEFAULT_SNAPSHOT, target: "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--snapshot") args.snapshot = resolve(argv[++i] ?? "");
    else if (arg.startsWith("--snapshot=")) args.snapshot = resolve(arg.slice("--snapshot=".length));
    else if (arg === "--target") args.target = resolve(argv[++i] ?? "");
    else if (arg.startsWith("--target=")) args.target = resolve(arg.slice("--target=".length));
  }
  return args;
}

/**
 * Resolve the Tauri app data directory for the given bundle identifier,
 * matching `AppHandle::path().app_data_dir()` on each OS.
 */
function appDataDir(identifier) {
  const home = homedir();
  switch (platform()) {
    case "win32": {
      const base = process.env.APPDATA ?? join(home, "AppData", "Roaming");
      return join(base, identifier);
    }
    case "darwin":
      return join(home, "Library", "Application Support", identifier);
    default: {
      const base = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
      return join(base, identifier);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.snapshot)) {
    console.error(`Snapshot not found: ${args.snapshot}`);
    console.error("Run a values sync first, e.g.:");
    console.error("  npm run sync:values --workspace @tradelens/source-adapters");
    process.exit(1);
  }

  const raw = readFileSync(args.snapshot, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Snapshot is not valid JSON: ${(err && err.message) || err}`);
    process.exit(1);
  }
  const revision = parsed?.revision;
  const generatedAt = parsed?.generatedAt;
  if (typeof revision !== "number" || typeof generatedAt !== "string") {
    console.error("Snapshot is missing a numeric `revision` or string `generatedAt`.");
    process.exit(1);
  }

  const targetDir = args.target || appDataDir(APP_IDENTIFIER);
  const targetFile = join(targetDir, EXTERNAL_SNAPSHOT_FILE);

  console.log(`Source snapshot : ${args.snapshot}`);
  console.log(`Revision        : ${revision} (generated ${generatedAt})`);
  console.log(`Target          : ${targetFile}`);

  if (args.dryRun) {
    console.log("\nDry run — nothing written.");
    return;
  }

  mkdirSync(targetDir, { recursive: true });
  writeFileSync(targetFile, raw);
  console.log("\nPublished. Open MM2 TradeLens and press \u201cCheck for updates\u201d.");
}

main();
