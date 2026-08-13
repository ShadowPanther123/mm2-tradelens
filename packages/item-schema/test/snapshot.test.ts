import { describe, it, expect } from "vitest";
import {
  canonicaliseSnapshot,
  CURRENT_SCHEMA_VERSION,
  parseSnapshot,
  safeParseSignedSnapshot,
  type SignedSnapshot,
  type ValueSnapshot,
} from "../src/index.js";

const NOW = "2026-01-01T00:00:00.000Z";

const base: ValueSnapshot = {
  schemaVersion: 1,
  revision: 3,
  generatedAt: NOW,
  sources: ["supreme", "mm2values"],
  items: [
    {
      id: "seer",
      displayName: "Seer",
      aliases: [],
      category: "gun",
      rarity: "godly",
      chroma: false,
      verified: true,
      values: {
        supreme: { value: 40, updatedAt: NOW },
        mm2values: { value: 41, updatedAt: NOW },
      },
    },
  ],
};

describe("canonicaliseSnapshot", () => {
  it("is stable regardless of key insertion order", () => {
    const reordered = {
      items: base.items,
      generatedAt: base.generatedAt,
      sources: base.sources,
      revision: base.revision,
      schemaVersion: base.schemaVersion,
    } as ValueSnapshot;
    expect(canonicaliseSnapshot(reordered)).toBe(canonicaliseSnapshot(base));
  });

  it("changes when meaningful data changes", () => {
    const bumped = { ...base, revision: base.revision + 1 };
    expect(canonicaliseSnapshot(bumped)).not.toBe(canonicaliseSnapshot(base));
  });
});

describe("schema constants", () => {
  it("exposes the current schema version", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(parseSnapshot(base).schemaVersion).toBe(1);
  });
});

describe("source history invariants", () => {
  it("rejects history that is not ordered oldest first", () => {
    const invalid = structuredClone(base);
    invalid.items[0]!.values.supreme!.history = [
      { value: 35, at: "2026-01-02T00:00:00.000Z" },
      { value: 40, at: "2026-01-01T00:00:00.000Z" },
    ];
    expect(() => parseSnapshot(invalid)).toThrow(/history must be ordered oldest first/);
  });

  it("rejects history whose final value differs from the current reading", () => {
    const invalid = structuredClone(base);
    invalid.items[0]!.values.supreme!.history = [{ value: 35, at: "2025-12-31T00:00:00.000Z" }];
    expect(() => parseSnapshot(invalid)).toThrow(/history must end at the current value/);
  });
});

describe("safeParseSignedSnapshot", () => {
  it("accepts a well-formed envelope", () => {
    const signed: SignedSnapshot = {
      algorithm: "ed25519",
      keyId: "k1",
      signature: "AAAA",
      snapshot: base,
    };
    expect(safeParseSignedSnapshot(signed).success).toBe(true);
  });

  it("rejects a malformed envelope", () => {
    expect(safeParseSignedSnapshot({ algorithm: "rsa" }).success).toBe(false);
  });
});
