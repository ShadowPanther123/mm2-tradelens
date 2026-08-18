import { describe, expect, it } from "vitest";
import { staleHighRevisionReason } from "../../../scripts/verify-snapshot-fresh.mjs";

const at = (iso) => ({ generatedAt: iso });

describe("staleHighRevisionReason", () => {
  it("allows shipping when the feed is the same or newer", () => {
    expect(
      staleHighRevisionReason(
        { revision: 16, ...at("2026-08-16T00:00:00Z") },
        { revision: 16, ...at("2026-08-16T00:00:00Z") },
      ),
    ).toBeNull();
    expect(
      staleHighRevisionReason(
        { revision: 15, ...at("2026-08-14T00:00:00Z") },
        { revision: 16, ...at("2026-08-16T00:00:00Z") },
      ),
    ).toBeNull();
  });

  it("allows a higher revision that is at least as fresh as the feed", () => {
    expect(
      staleHighRevisionReason(
        { revision: 26, ...at("2026-08-18T06:24:54Z") },
        { revision: 16, ...at("2026-08-16T18:16:15Z") },
      ),
    ).toBeNull();
  });

  it("blocks a higher-numbered but older snapshot (the stale-high-revision trap)", () => {
    const reason = staleHighRevisionReason(
      { revision: 25, ...at("2026-08-15T01:30:43Z") },
      { revision: 16, ...at("2026-08-16T18:16:15Z") },
    );
    expect(reason).toContain("revision 25");
    expect(reason).toContain("downgrade");
  });

  it("falls back to allow when timestamps are unparseable", () => {
    expect(
      staleHighRevisionReason(
        { revision: 25, generatedAt: "not-a-date" },
        { revision: 16, ...at("2026-08-16T18:16:15Z") },
      ),
    ).toBeNull();
  });
});
