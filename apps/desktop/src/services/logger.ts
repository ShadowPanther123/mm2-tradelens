/**
 * Lightweight structured diagnostics log.
 *
 * TradeLens is offline-first and privacy-respecting, so diagnostics stay on the
 * device: entries are mirrored to the console (for live debugging) and kept in
 * a small in-memory ring buffer that the user can export from the recovery
 * screen or settings. Nothing is ever sent anywhere.
 *
 * The goal is twofold:
 *  - never silently swallow an important error (everything notable is recorded), and
 *  - give a single, structured place to capture both frontend and Rust-side
 *    failures (Rust errors arrive as `{ kind, message }` and are logged here by
 *    the calling code).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
  /** Optional structured context (already sanitised of anything sensitive). */
  detail?: Record<string, unknown>;
}

/** Keep the buffer bounded so long sessions can't grow memory without limit. */
const MAX_ENTRIES = 500;

const buffer: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();

function push(
  level: LogLevel,
  scope: string,
  message: string,
  detail?: Record<string, unknown>,
) {
  const entry: LogEntry = { time: new Date().toISOString(), level, scope, message };
  if (detail && Object.keys(detail).length > 0) entry.detail = detail;

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);

  // Mirror to the console so live debugging still works.
  const line = `[TradeLens:${scope}] ${message}`;
  // eslint-disable-next-line no-console
  const sink =
    level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  if (detail) sink(line, detail);
  else sink(line);

  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      // A misbehaving listener must never break logging.
    }
  }
}

export const logger = {
  debug: (scope: string, message: string, detail?: Record<string, unknown>) =>
    push("debug", scope, message, detail),
  info: (scope: string, message: string, detail?: Record<string, unknown>) =>
    push("info", scope, message, detail),
  warn: (scope: string, message: string, detail?: Record<string, unknown>) =>
    push("warn", scope, message, detail),
  error: (scope: string, message: string, detail?: Record<string, unknown>) =>
    push("error", scope, message, detail),

  /** Snapshot of the current buffered entries (most recent last). */
  entries(): readonly LogEntry[] {
    return buffer.slice();
  },

  /** Subscribe to new entries; returns an unsubscribe function. */
  subscribe(fn: (entry: LogEntry) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/**
 * Normalise an unknown thrown value into a structured record. Understands both
 * plain `Error`s and the Rust command bridge's `{ kind, message }` shape.
 */
export function describeError(err: unknown): { kind: string; message: string } {
  if (err && typeof err === "object") {
    const obj = err as { kind?: unknown; message?: unknown };
    if (typeof obj.kind === "string" && typeof obj.message === "string") {
      return { kind: obj.kind, message: obj.message };
    }
    if (typeof obj.message === "string") {
      return { kind: err instanceof Error ? "error" : "unknown", message: obj.message };
    }
  }
  return { kind: "unknown", message: String(err) };
}

/**
 * Build a plain-text diagnostics report for export. Includes environment basics
 * and the buffered log. Contains no personal data beyond what the user has
 * entered into the app (favorites/history are never included).
 */
export function buildDiagnosticsReport(extra?: Record<string, unknown>): string {
  const header = [
    `TradeLens diagnostics`,
    `generated: ${new Date().toISOString()}`,
    `userAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`,
    `online: ${typeof navigator !== "undefined" ? navigator.onLine : "n/a"}`,
  ];
  if (extra) {
    for (const [k, v] of Object.entries(extra))
      header.push(`${k}: ${JSON.stringify(v)}`);
  }
  const lines = buffer.map((e) => {
    const detail = e.detail ? ` ${JSON.stringify(e.detail)}` : "";
    return `${e.time} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.message}${detail}`;
  });
  return [...header, "", "--- log ---", ...lines, ""].join("\n");
}

/** Trigger a browser download of the diagnostics report. */
export function downloadDiagnostics(extra?: Record<string, unknown>): void {
  const report = buildDiagnosticsReport(extra);
  const blob = new Blob([report], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tradelens-diagnostics-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
