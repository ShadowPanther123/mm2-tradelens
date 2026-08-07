import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleSnapshot } from "@tradelens/source-adapters/sample";
import {
  DEFAULT_SNAPSHOT_URL,
  fetchRemoteSnapshot,
  updateStatusMessage,
  type UpdateStatus,
} from "./updates";

/** Build a minimal Response-like object for the mocked fetch. */
function response(
  body: unknown,
  { ok = true, status = 200, headers = {} as Record<string, string> } = {},
): Response {
  return {
    ok,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Route the mocked fetch by URL suffix. */
function routeFetch(routes: {
  revision?: () => Response | Promise<Response>;
  snapshot?: () => Response | Promise<Response>;
  throws?: boolean;
}) {
  return vi.fn(async (url: string) => {
    if (routes.throws) throw new Error("network down");
    if (url.endsWith("/v1/revision")) {
      return routes.revision ? routes.revision() : response(null, { ok: false, status: 404 });
    }
    return routes.snapshot ? routes.snapshot() : response(null, { ok: false, status: 404 });
  });
}

const freshSnapshot = (revision: number) => ({
  ...sampleSnapshot,
  revision,
  generatedAt: new Date().toISOString(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRemoteSnapshot outcomes", () => {
  it("reports offline when the device has no connectivity", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRemoteSnapshot(DEFAULT_SNAPSHOT_URL, 1000, 1, 0);
    expect(outcome.status).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports not-configured for an empty endpoint", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const outcome = await fetchRemoteSnapshot("", 1000, 1, 0);
    expect(outcome.status).toBe("not-configured");
  });

  it("short-circuits to already-current via the revision pre-check", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = routeFetch({ revision: () => response({ revision: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRemoteSnapshot(DEFAULT_SNAPSHOT_URL, 1000, 1, 0);
    expect(outcome.status).toBe("already-current");
    // The full snapshot was never downloaded.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns updated for a newer, valid snapshot", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = routeFetch({
      revision: () => response({ revision: 999 }),
      snapshot: () => response(freshSnapshot(999)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRemoteSnapshot(DEFAULT_SNAPSHOT_URL, 1000, 1, 0);
    expect(outcome.status).toBe("updated");
    if (outcome.status === "updated") expect(outcome.snapshot.revision).toBe(999);
  });

  it("distinguishes a schema failure from a network failure", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = routeFetch({ snapshot: () => response({ not: "a snapshot" }) });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRemoteSnapshot(DEFAULT_SNAPSHOT_URL, 1000, 1, 0);
    expect(outcome.status).toBe("schema-failure");
  });

  it("reports a 4xx server error distinctly", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = routeFetch({
      snapshot: () => response({ error: "not_found" }, { ok: false, status: 404 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRemoteSnapshot(DEFAULT_SNAPSHOT_URL, 1000, 1, 0);
    expect(outcome.status).toBe("server-error");
    if (outcome.status === "server-error") expect(outcome.httpStatus).toBe(404);
  });

  it("reports a network error when the request throws", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", routeFetch({ throws: true }));

    const outcome = await fetchRemoteSnapshot(DEFAULT_SNAPSHOT_URL, 1000, 1, 0);
    expect(outcome.status).toBe("network-error");
  });
});

describe("updateStatusMessage", () => {
  const statuses: UpdateStatus[] = [
    "updated",
    "already-current",
    "offline",
    "disabled",
    "not-configured",
    "network-error",
    "server-error",
    "invalid-data",
    "schema-failure",
    "signature-failure",
    "database-error",
  ];

  it("returns a calm, non-empty message for every status", () => {
    for (const status of statuses) {
      const message = updateStatusMessage(status);
      expect(message.length).toBeGreaterThan(0);
      // Messages should stay user-friendly, not leak jargon.
      expect(message.toLowerCase()).not.toContain("http");
      expect(message.toLowerCase()).not.toContain("schema");
    }
  });
});
