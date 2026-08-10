import {
  CURRENT_SCHEMA_VERSION,
  safeParseSignedSnapshot,
  safeParseSnapshot,
} from "@tradelens/item-schema";
import { verifySignedSnapshot } from "@tradelens/snapshot-signing";
import type { ValueSnapshot } from "@/types";
import { logger } from "@/services/logger";

/**
 * Optional remote value feed. TradeLens is offline-first: it always works from
 * the cached snapshot, and simply tops up from a self-hosted values-api when
 * one is reachable. Rather than collapsing every problem to `null`, a fetch
 * returns a structured {@link FetchOutcome} so callers can distinguish, for
 * example, "already current" from "offline", a network failure from invalid
 * data, and a signature failure from a schema failure — and show a calm,
 * appropriate message while the full technical detail is logged locally.
 *
 * Updates are only accepted when they are:
 *  - served over the configured endpoint,
 *  - within a sane size limit,
 *  - a schema version this build understands,
 *  - signed by the trusted key (when a public key is configured),
 *  - newer than the current revision (no silent downgrades),
 *  - stamped with a plausible (not future-dated, not ancient) timestamp.
 */

/**
 * Structured result of an update attempt. Exactly one applies; the caller
 * branches on `status`.
 */
export type FetchOutcome =
  /** A newer, verified snapshot was fetched and is ready to cache. */
  | { status: "updated"; snapshot: ValueSnapshot }
  /** The server responded, but its revision is not newer than ours. */
  | { status: "already-current"; revision: number }
  /** The device appears to be offline (no connectivity). */
  | { status: "offline" }
  /** The feed is not configured for this build (e.g. no HTTPS endpoint/key). */
  | { status: "not-configured" }
  /** Reached the network but the request failed/timed out (transient). */
  | { status: "network-error"; detail: string }
  /** The server answered with an HTTP error status. */
  | { status: "server-error"; httpStatus: number }
  /** Payload downloaded but is malformed, too large, or implausible. */
  | { status: "invalid-data"; detail: string }
  /** Payload's schema/version could not be understood by this build. */
  | { status: "schema-failure"; detail: string }
  /** Payload's cryptographic signature did not verify. */
  | { status: "signature-failure"; detail: string };

/** Largest snapshot payload we will download (protects against oversized bodies). */
const MAX_SNAPSHOT_BYTES = 8_000_000;
/** Reject snapshots generated further than this into the future (clock skew allowance). */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
/** Remote snapshots older than this are not a credible update. */
const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Endpoint configuration. In production the feed must be an HTTPS URL supplied
 * via `VITE_SNAPSHOT_URL`; in development it falls back to the local values-api.
 */
const CONFIGURED_URL = import.meta.env.VITE_SNAPSHOT_URL as string | undefined;
const IS_PROD = import.meta.env.PROD;

/** Base endpoint for the values feed (a snapshot path is derived from it). */
export const DEFAULT_SNAPSHOT_URL =
  CONFIGURED_URL ?? (IS_PROD ? "" : "http://localhost:8787/v1/snapshot");

/**
 * Trusted signing public key (raw Ed25519, base64). Configure via
 * `VITE_SNAPSHOT_PUBLIC_KEY` at build time. When empty, signature verification
 * is skipped — acceptable only for local development.
 */
const TRUSTED_PUBLIC_KEY =
  (import.meta.env.VITE_SNAPSHOT_PUBLIC_KEY as string | undefined) ?? "";

/**
 * Whether a production values service is properly configured. A production
 * build must have both an HTTPS endpoint and a public verification key; without
 * them the app stays fully functional offline but will not accept remote
 * updates.
 */
export const isValuesServiceConfigured =
  DEFAULT_SNAPSHOT_URL.startsWith("https://") && TRUSTED_PUBLIC_KEY.length > 0;

/**
 * Whether remote snapshots are cryptographically verified before use. True only
 * when a trusted public key is configured; the UI uses this so it never claims
 * "signed updates" unless signatures are actually enforced.
 */
export const signaturesEnforced = TRUSTED_PUBLIC_KEY.length > 0;
/** True only for the unsigned localhost-style feed used while developing. */
export const isUnverifiedDevelopmentFeed =
  !IS_PROD && DEFAULT_SNAPSHOT_URL.length > 0 && !signaturesEnforced;

/** Validate the trust configuration before any remote request is attempted. */
export function isRemoteFeedUsable(
  url: string,
  production = IS_PROD,
  publicKey = TRUSTED_PUBLIC_KEY,
): boolean {
  if (!url) return false;
  return !production || (url.startsWith("https://") && publicKey.length > 0);
}

// Surface a one-time, clear warning in production when the values service is
// not configured, so a misbuilt release is obvious rather than silent.
if (IS_PROD && !isValuesServiceConfigured) {
  logger.warn(
    "updates",
    "No production values service configured " +
      "(VITE_SNAPSHOT_URL must be HTTPS and VITE_SNAPSHOT_PUBLIC_KEY must be set). " +
      "The app will run offline from cached values and will not apply remote updates.",
  );
}

/** Derive the signed-envelope URL from a plain snapshot URL. */
function toSignedUrl(url: string): string {
  return url.replace(/\/v1\/snapshot$/, "/v1/signed-snapshot");
}

/** Derive the lightweight revision URL from a plain snapshot URL. */
function toRevisionUrl(url: string): string {
  return url.replace(/\/v1\/snapshot$/, "/v1/revision");
}

/**
 * Overall status of an update check as seen by the UI. Extends the network
 * {@link FetchOutcome} states with two local ones: `disabled` (offline mode)
 * and `database-error` (the snapshot could not be cached locally).
 */
export type UpdateStatus =
  | FetchOutcome["status"]
  | "disabled"
  | "database-error";

/**
 * Calm, non-technical message for each update status, safe to show the user.
 * Full technical detail is written to the local diagnostics log instead.
 */
export function updateStatusMessage(status: UpdateStatus): string {
  switch (status) {
    case "updated":
      return "Values updated to the latest revision.";
    case "already-current":
      return "You're already on the latest values.";
    case "offline":
      return "You're offline — showing cached values.";
    case "disabled":
      return "Offline mode is on. Turn it off to check for updates.";
    case "not-configured":
      return "No values service is set up for this build. Cached values are in use.";
    case "network-error":
      return "Couldn't reach the values service just now. We'll try again later.";
    case "server-error":
      return "The values service is having trouble. We'll try again later.";
    case "invalid-data":
      return "The latest values looked off, so they were skipped for safety.";
    case "schema-failure":
      return "The latest values need a newer app version, so they were skipped.";
    case "signature-failure":
      return "The latest values couldn't be verified, so they were skipped for safety.";
    case "database-error":
      return "Couldn't save the latest values locally. Your existing values are unchanged.";
  }
}

function isFreshTimestamp(generatedAt: string): boolean {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return t >= now - MAX_SNAPSHOT_AGE_MS && t <= now + MAX_FUTURE_SKEW_MS;
}

async function readCappedJson(res: Response): Promise<unknown | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_SNAPSHOT_BYTES) return null;
  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A transient failure that is worth retrying (network/timeout/5xx). */
class TransientError extends Error {}

/**
 * Attempt to fetch, verify, and validate a remote snapshot, returning a
 * structured {@link FetchOutcome}. Transient failures (network/timeout/5xx) are
 * retried a few times with exponential backoff; a payload that is fetched but
 * rejected (bad signature, wrong schema, downgrade) is never retried. Every
 * non-success outcome is logged locally with its technical detail.
 *
 * @param currentRevision revision already installed; updates must exceed it.
 */
export async function fetchRemoteSnapshot(
  url: string = DEFAULT_SNAPSHOT_URL,
  timeoutMs = 4000,
  currentRevision = -1,
  retries = 3,
): Promise<FetchOutcome> {
  if (!isRemoteFeedUsable(url)) {
    logger.warn("updates", "no usable values endpoint configured; skipping check");
    return { status: "not-configured" };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { status: "offline" };
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const outcome = await attemptFetch(url, controller.signal, currentRevision);
      // A 5xx is treated as transient and retried; everything else is final.
      if (outcome.status === "server-error" && outcome.httpStatus >= 500) {
        throw new TransientError(`server ${outcome.httpStatus}`);
      }
      if (outcome.status !== "updated") {
        logger.info("updates", `update check → ${outcome.status}`, describeOutcome(outcome));
      }
      return outcome;
    } catch (err) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (offline) return { status: "offline" };
      if (attempt === retries) {
        const detail = (err as Error).message || "network error";
        logger.warn("updates", `update check failed after ${retries + 1} attempts`, { detail });
        return { status: "network-error", detail };
      }
      // Exponential backoff with a little jitter: ~0.4s, 0.8s, 1.6s (+/- 20%).
      const base = 400 * 2 ** attempt;
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      await delay(Math.round(base + jitter));
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: "network-error", detail: "exhausted retries" };
}

/** One fetch+validate pass. Throws only on transient network/timeout errors. */
async function attemptFetch(
  url: string,
  signal: AbortSignal,
  currentRevision: number,
): Promise<FetchOutcome> {
  // Lightweight pre-check: ask only for the current revision number first, so
  // we don't re-download a full snapshot we already have. Best-effort — if the
  // endpoint is unavailable (older server), fall through to the full fetch.
  const known = await fetchRevision(toRevisionUrl(url), signal);
  if (known !== null && known <= currentRevision) {
    return { status: "already-current", revision: known };
  }

  const outcome = TRUSTED_PUBLIC_KEY
    ? await fetchSigned(toSignedUrl(url), signal)
    : await fetchUnsigned(url, signal);
  if (outcome.status !== "updated") return outcome;

  const snapshot = outcome.snapshot;
  if (snapshot.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      status: "schema-failure",
      detail: `unsupported schema version ${snapshot.schemaVersion} (expected ${CURRENT_SCHEMA_VERSION})`,
    };
  }
  if (!isFreshTimestamp(snapshot.generatedAt)) {
    return { status: "invalid-data", detail: `implausible generatedAt ${snapshot.generatedAt}` };
  }
  if (snapshot.revision <= currentRevision) {
    return { status: "already-current", revision: snapshot.revision };
  }
  return { status: "updated", snapshot };
}

/**
 * Fetch just the current revision number from the lightweight `/v1/revision`
 * endpoint. Returns null (skip the pre-check) when the endpoint is missing or
 * unreadable; re-throws genuine network errors so the caller can retry.
 */
async function fetchRevision(url: string, signal: AbortSignal): Promise<number | null> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const body = await readCappedJson(res);
  if (!body || typeof body !== "object") return null;
  const rev = (body as { revision?: unknown }).revision;
  return typeof rev === "number" && Number.isFinite(rev) ? rev : null;
}

function describeOutcome(outcome: FetchOutcome): Record<string, unknown> {
  const rest = { ...outcome } as Record<string, unknown>;
  delete rest.status;
  return rest;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch and cryptographically verify a signed snapshot envelope. */
async function fetchSigned(url: string, signal: AbortSignal): Promise<FetchOutcome> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) return { status: "server-error", httpStatus: res.status };
  const body = await readCappedJson(res);
  if (body === null) return { status: "invalid-data", detail: "empty or oversized body" };
  const parsed = safeParseSignedSnapshot(body);
  if (!parsed.success) {
    return { status: "schema-failure", detail: "signed envelope failed schema validation" };
  }
  const result = await verifySignedSnapshot(parsed.data, TRUSTED_PUBLIC_KEY);
  if (!result.valid) {
    return {
      status: "signature-failure",
      detail: `revision ${parsed.data.snapshot.revision} key ${parsed.data.keyId}: ${result.reason}`,
    };
  }
  logger.info(
    "updates",
    `signature verified for revision ${parsed.data.snapshot.revision} (key ${parsed.data.keyId})`,
  );
  return { status: "updated", snapshot: parsed.data.snapshot as ValueSnapshot };
}

/** Fetch an unsigned snapshot (development only). */
async function fetchUnsigned(url: string, signal: AbortSignal): Promise<FetchOutcome> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) return { status: "server-error", httpStatus: res.status };
  const body = await readCappedJson(res);
  if (body === null) return { status: "invalid-data", detail: "empty or oversized body" };
  const parsed = safeParseSnapshot(body);
  if (!parsed.success) return { status: "schema-failure", detail: "snapshot failed schema validation" };
  return { status: "updated", snapshot: parsed.data as ValueSnapshot };
}
