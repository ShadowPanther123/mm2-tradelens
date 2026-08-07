import { describe, expect, it } from "vitest";
import { buildDiagnosticsReport, describeError, logger } from "./logger";

describe("describeError", () => {
  it("understands the Rust command bridge shape", () => {
    expect(describeError({ kind: "database", message: "disk full" })).toEqual({
      kind: "database",
      message: "disk full",
    });
  });

  it("understands a plain Error", () => {
    const out = describeError(new Error("boom"));
    expect(out.message).toBe("boom");
    expect(out.kind).toBe("error");
  });

  it("falls back to a string for anything else", () => {
    expect(describeError(42)).toEqual({ kind: "unknown", message: "42" });
  });
});

describe("diagnostics log", () => {
  it("records entries and includes them in the report", () => {
    logger.warn("test-scope", "a noteworthy thing happened", { code: 7 });
    const report = buildDiagnosticsReport({ extraField: "value" });

    expect(report).toContain("TradeLens diagnostics");
    expect(report).toContain("extraField");
    expect(report).toContain("a noteworthy thing happened");
    expect(report).toContain("[test-scope]");
  });

  it("notifies subscribers of new entries", () => {
    const seen: string[] = [];
    const unsubscribe = logger.subscribe((e) => seen.push(e.message));
    logger.info("test-scope", "hello");
    unsubscribe();
    logger.info("test-scope", "after unsubscribe");

    expect(seen).toContain("hello");
    expect(seen).not.toContain("after unsubscribe");
  });
});
