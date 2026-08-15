import { describe, expect, it } from "vitest";
import type { ValueSnapshot } from "@/types";
import { isNewerSnapshot } from "./useDataStore";

function snap(revision: number, generatedAt: string): ValueSnapshot {
  return {
    schemaVersion: 1,
    revision,
    generatedAt,
    sources: ["mm2values"],
    items: [],
  } as unknown as ValueSnapshot;
}

describe("isNewerSnapshot", () => {
  it("accepts a higher revision with a newer timestamp", () => {
    const current = snap(16, "2026-08-14T00:00:00.000Z");
    const candidate = snap(17, "2026-08-15T00:00:00.000Z");
    expect(isNewerSnapshot(current, candidate)).toBe(true);
  });

  it("rejects an equal or lower revision", () => {
    const current = snap(23, "2026-08-14T00:00:00.000Z");
    expect(isNewerSnapshot(current, snap(23, "2026-08-20T00:00:00.000Z"))).toBe(false);
    expect(isNewerSnapshot(current, snap(10, "2026-08-20T00:00:00.000Z"))).toBe(false);
  });

  it("refuses a higher revision that carries older values (stale-revision trap)", () => {
    // The exact failure that stranded the installed app on rev 22 / 8 Aug data:
    // a snapshot with an inflated revision but an OLDER generatedAt must never
    // supersede fresher current values.
    const current = snap(16, "2026-08-14T21:59:30.371Z");
    const staleButHigher = snap(22, "2026-08-12T00:00:00.000Z");
    expect(isNewerSnapshot(current, staleButHigher)).toBe(false);
  });

  it("still accepts a higher revision when timestamps are unparseable", () => {
    const current = snap(16, "not-a-date");
    const candidate = snap(17, "also-not-a-date");
    expect(isNewerSnapshot(current, candidate)).toBe(true);
  });
});
