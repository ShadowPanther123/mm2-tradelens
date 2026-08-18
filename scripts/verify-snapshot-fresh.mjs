// @ts-check
/**
 * Guard against shipping a "stale-high-revision" snapshot.
 *
 * The desktop app adopts a new value snapshot only when its revision number is
 * higher than the one it already has. If an installer is ever built from a
 * local snapshot whose revision number was bumped WITHOUT refreshing the
 * values (e.g. an icon/category reconcile, or a hand edit), that installer can
 * ship a high revision number carrying old values. Such an app then rejects the
 * live GitHub Pages feed as a "downgrade" (feed revision < shipped revision)
 * and freezes on stale data forever.
 *
 * This check compares the snapshot that is about to be bundled against the live
 * feed and fails the build if the local snapshot is a stale-high-revision one
 * (higher revision but an OLDER generatedAt than the feed). It is
 * offline-tolerant: if the feed cannot be reached (no network / CI without
 * egress) it warns and passes so builds are never blocked by connectivity.
 *
 * Run:
 *   node scripts/verify-snapshot-fresh.mjs
 *   node scripts/verify-snapshot-fresh.mjs --feed=https://host/v1/snapshot
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const snapshotPath = join(root, "packages", "source-adapters", "src", "mm2values-snapshot.json");

const DEFAULT_FEED_URL = "https://shadowpanther123.github.io/mm2-tradelens/v1/snapshot";
const REQUEST_TIMEOUT_MS = 15_000;

/** Read VITE_SNAPSHOT_URL from apps/desktop/.env.production, if present. */
function feedUrlFromEnv() {
  const envPath = join(root, "apps", "desktop", ".env.production");
  if (!existsSync(envPath)) return undefined;
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*VITE_SNAPSHOT_URL\s*=/.test(l) && !/^\s*#/.test(l));
  if (!line) return undefined;
  const value = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  return value.length > 0 ? value : undefined;
}

function resolveFeedUrl(argv) {
  const flag = argv.find((a) => a.startsWith("--feed="));
  if (flag) return flag.slice("--feed=".length);
  return process.env.SNAPSHOT_FEED_URL || feedUrlFromEnv() || DEFAULT_FEED_URL;
}

/** Parse an ISO timestamp to epoch ms, or NaN when absent/unparseable. */
function toTime(value) {
  if (typeof value !== "string") return Number.NaN;
  return Date.parse(value);
}

async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "mm2-tradelens-freshness-check/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide whether `local` is a stale-high-revision snapshot relative to `feed`.
 * Returns a reason string when it is unsafe to ship, otherwise null.
 */
export function staleHighRevisionReason(local, feed) {
  const localRev = local?.revision ?? 0;
  const feedRev = feed?.revision ?? 0;
  if (localRev <= feedRev) return null; // feed is same/newer — app will adopt it.
  const localTime = toTime(local?.generatedAt);
  const feedTime = toTime(feed?.generatedAt);
  // Only block when we can prove the local snapshot is OLDER despite the higher
  // revision number. Unparseable timestamps fall back to "allow" (revision-only)
  // so we never block on ambiguous data.
  if (Number.isNaN(localTime) || Number.isNaN(feedTime)) return null;
  if (localTime >= feedTime) return null; // higher revision AND at least as fresh — fine.
  return (
    `Local snapshot revision ${localRev} (generated ${local.generatedAt}) is NEWER-numbered ` +
    `but OLDER than the live feed revision ${feedRev} (generated ${feed.generatedAt}). ` +
    `Shipping it would make installed apps reject the feed as a downgrade. ` +
    `Run "npm run sync:values" to capture fresh values before building.`
  );
}

async function main() {
  const local = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const feedUrl = resolveFeedUrl(process.argv.slice(2));

  let feed;
  try {
    feed = await fetchFeed(feedUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `Freshness check: could not reach the value feed (${message}). ` +
        `Skipping the stale-high-revision guard for this build.`,
    );
    return;
  }

  const reason = staleHighRevisionReason(local, feed);
  if (reason) {
    // eslint-disable-next-line no-console
    console.error(`Freshness check FAILED: ${reason}`);
    process.exitCode = 1;
    return;
  }

  if ((local.revision ?? 0) < (feed.revision ?? 0)) {
    // eslint-disable-next-line no-console
    console.warn(
      `Freshness check: local snapshot revision ${local.revision} is behind the live feed ` +
        `revision ${feed.revision}. The app will auto-adopt the feed, but consider syncing to ` +
        `bundle the latest values.`,
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Freshness check passed: local revision ${local.revision} (generated ${local.generatedAt}) ` +
      `is consistent with feed revision ${feed.revision}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
