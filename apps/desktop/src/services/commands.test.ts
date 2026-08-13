import { describe, expect, it, vi } from "vitest";

// The command module imports Tauri's `invoke`; mock it so the module loads in a
// plain Node test environment without a Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { validateResponse } from "./commands";
import type { ValueSnapshot } from "@/types";

const validSnapshot = {
  schemaVersion: 1,
  revision: 3,
  generatedAt: "2026-07-31T00:00:00.000Z",
  sources: ["supreme"],
  items: [
    {
      id: "seer",
      displayName: "Seer",
      aliases: [],
      category: "gun",
      rarity: "godly",
      chroma: false,
      verified: true,
      values: { supreme: { value: 40, updatedAt: "2026-07-31T00:00:00.000Z" } },
    },
  ],
} as unknown as ValueSnapshot;

describe("command response validation", () => {
  it("passes a well-formed snapshot through unchanged", () => {
    const result = validateResponse("get_snapshot", validSnapshot);
    expect(result?.revision).toBe(3);
  });

  it("accepts a null snapshot", () => {
    expect(validateResponse("get_snapshot", null)).toBeNull();
  });

  it("rejects a malformed snapshot", () => {
    expect(() => validateResponse("get_snapshot", { revision: "nope" })).toThrow(
      /invalid snapshot/,
    );
  });

  it("rejects a non-array favorites response", () => {
    expect(() => validateResponse("list_favorites", { not: "an array" })).toThrow(
      /did not return an array/,
    );
  });

  it("rejects a non-array history response", () => {
    expect(() => validateResponse("list_history", 42)).toThrow(
      /did not return an array/,
    );
  });

  it("passes through commands without a registered validator", () => {
    expect(validateResponse("is_favorite", true)).toBe(true);
  });
});
