import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { SourceId } from "@tradelens/item-schema";
import { type RawRow, auditReportToCsv } from "@tradelens/source-adapters";
import { store } from "./store.js";

/**
 * Minimal dependency-free HTTP API for TradeLens value snapshots.
 *
 * Routes:
 *   GET  /health                — liveness probe
 *   GET  /v1/revision           — current revision + generatedAt (tiny; for polling)
 *   GET  /v1/revisions          — every retained revision (for rollback UI)
 *   GET  /v1/snapshot           — latest normalised snapshot (+ checksum header)
 *   GET  /v1/signed-snapshot    — Ed25519-signed snapshot envelope (if configured)
 *   GET  /v1/public-key         — signing key id + raw public key (base64)
 *   GET  /v1/items/:id          — single item
 *   GET  /v1/admin/audit        — audit report for the current snapshot (token-gated)
 *   GET  /v1/admin/audit.csv    — audit report as CSV (token-gated)
 *   GET  /v1/admin/staged       — staged candidate snapshot + audit (token-gated)
 *   POST /v1/admin/import       — immediate admin import fallback (token-gated)
 *   POST /v1/admin/stage        — stage rows for review (token-gated)
 *   POST /v1/admin/publish      — publish the staged candidate (token-gated)
 *   POST /v1/admin/discard      — discard the staged candidate (token-gated)
 *   POST /v1/admin/rollback     — roll back to the previous revision (token-gated)
 */

const PORT = Number(process.env.PORT ?? 8787);
const ADMIN_TOKEN = process.env.TRADELENS_ADMIN_TOKEN ?? "";

/**
 * Security headers applied to every response. The API serves JSON/CSV only and
 * is never framed, so lock down sniffing, framing and referrer leakage. A
 * restrictive CSP is included as defence in depth even though responses carry
 * no HTML.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-site",
};

/**
 * Simple fixed-window, in-memory rate limiter keyed by client + bucket. Guards
 * the API from being hammered; a production deployment behind a proxy would
 * layer a distributed limiter on top, but this stops trivial abuse on its own.
 */
const RATE_LIMITS = {
  /** Read endpoints: generous, per-IP. */
  read: { windowMs: 60_000, max: 300 },
  /** Admin mutations: strict, since each triggers real work. */
  admin: { windowMs: 60_000, max: 30 },
} as const;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, limit: { windowMs: number; max: number }): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit.max;
}

/** Best-effort client identifier for rate limiting (proxy-aware). */
function clientId(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first?.trim() || req.socket.remoteAddress || "unknown").toString();
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-snapshot-checksum, x-snapshot-revision",
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Constant-time bearer check for the admin routes. */
function authorized(req: IncomingMessage): boolean {
  if (!ADMIN_TOKEN) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${ADMIN_TOKEN}`);
  const provided = Buffer.from(header);
  // timingSafeEqual requires equal-length buffers; length differences are not
  // secret, so a fast unequal-length reject before the constant-time compare is
  // acceptable and avoids throwing.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Parse and validate the `{ sources }` body shared by import and stage. */
async function readSources(
  req: IncomingMessage,
): Promise<Partial<Record<SourceId, RawRow[]>> | undefined> {
  const body = (await readBody(req).catch(() => undefined)) as
    | { sources?: Partial<Record<SourceId, RawRow[]>> }
    | undefined;
  if (!body || typeof body !== "object" || !body.sources) return undefined;
  return body.sources;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
        ...SECURITY_HEADERS,
      });
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, { status: "ok" });
    }

    // Rate limit everything past the liveness probe. Admin mutations get the
    // stricter budget; read traffic gets the generous one.
    const isAdmin = pathname.startsWith("/v1/admin/");
    const limit = isAdmin ? RATE_LIMITS.admin : RATE_LIMITS.read;
    if (rateLimited(`${isAdmin ? "admin" : "read"}:${clientId(req)}`, limit)) {
      return json(res, 429, { error: "rate_limited" }, {
        "retry-after": String(Math.ceil(limit.windowMs / 1000)),
      });
    }

    if (req.method === "GET" && pathname === "/v1/revision") {
      const { snapshot } = store.get();
      return json(
        res,
        200,
        { revision: snapshot.revision, generatedAt: snapshot.generatedAt },
        { "x-snapshot-revision": String(snapshot.revision) },
      );
    }

    if (req.method === "GET" && pathname === "/v1/revisions") {
      return json(res, 200, { revisions: store.revisions(), canRollback: store.canRollback() });
    }

    if (req.method === "GET" && pathname === "/v1/snapshot") {
      const { snapshot, checksum } = store.get();
      return json(res, 200, snapshot, {
        "x-snapshot-checksum": checksum,
        "x-snapshot-revision": String(snapshot.revision),
      });
    }

    if (req.method === "GET" && pathname === "/v1/signed-snapshot") {
      const signed = store.getSigned();
      if (!signed) return json(res, 503, { error: "signing_not_configured" });
      return json(res, 200, signed, {
        "x-snapshot-revision": String(signed.snapshot.revision),
        "x-signing-key-id": signed.keyId,
      });
    }

    if (req.method === "GET" && pathname === "/v1/public-key") {
      const key = store.getPublicKey();
      if (!key) return json(res, 503, { error: "signing_not_configured" });
      return json(res, 200, key);
    }

    const itemMatch = pathname.match(/^\/v1\/items\/([a-z0-9-]+)$/);
    if (req.method === "GET" && itemMatch) {
      const item = store.getItem(itemMatch[1]!);
      if (!item) return json(res, 404, { error: "not_found" });
      return json(res, 200, item);
    }

    if (req.method === "POST" && pathname === "/v1/admin/import") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      const sources = await readSources(req);
      if (!sources) return json(res, 400, { error: "invalid_body" });
      const snapshot = store.importRows(sources);
      return json(res, 200, { revision: snapshot.revision, items: snapshot.items.length });
    }

    // Stage candidate rows for review without publishing.
    if (req.method === "POST" && pathname === "/v1/admin/stage") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      const sources = await readSources(req);
      if (!sources) return json(res, 400, { error: "invalid_body" });
      const { revision, audit } = store.stageRows(sources);
      return json(res, 200, { revision, audit });
    }

    // Inspect the staged candidate and its audit before publishing.
    if (req.method === "GET" && pathname === "/v1/admin/staged") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      const staged = store.getStaged();
      if (!staged) return json(res, 404, { error: "nothing_staged" });
      return json(res, 200, { snapshot: staged, audit: store.stagedAudit() });
    }

    // Publish the staged candidate after explicit review.
    if (req.method === "POST" && pathname === "/v1/admin/publish") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      const body = (await readBody(req).catch(() => undefined)) as
        | { requireClean?: boolean }
        | undefined;
      try {
        const snapshot = store.publish({ requireClean: body?.requireClean });
        return json(res, 200, { revision: snapshot.revision, items: snapshot.items.length });
      } catch (err) {
        return json(res, 409, { error: "publish_refused", detail: (err as Error).message });
      }
    }

    if (req.method === "POST" && pathname === "/v1/admin/discard") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      store.discardStaged();
      return json(res, 200, { discarded: true });
    }

    // Roll back to the previous published revision.
    if (req.method === "POST" && pathname === "/v1/admin/rollback") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      try {
        const snapshot = store.rollback();
        return json(res, 200, { revision: snapshot.revision, items: snapshot.items.length });
      } catch (err) {
        return json(res, 409, { error: "rollback_refused", detail: (err as Error).message });
      }
    }

    // Audit reports (JSON and CSV) for the current snapshot.
    if (req.method === "GET" && pathname === "/v1/admin/audit") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      return json(res, 200, store.audit());
    }

    if (req.method === "GET" && pathname === "/v1/admin/audit.csv") {
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="audit.csv"',
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        ...SECURITY_HEADERS,
      });
      res.end(auditReportToCsv(store.audit()));
      return;
    }

    return json(res, 404, { error: "not_found" });
  } catch (err) {
    return json(res, 400, { error: "bad_request", detail: (err as Error).message });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`TradeLens values-api listening on http://localhost:${PORT}`);
});

export { server };
