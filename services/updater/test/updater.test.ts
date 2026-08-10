import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/updater.js";

describe("updater command-line parsing", () => {
  it("rejects missing option values", () => {
    expect(() => parseArgs(["--verify"])).toThrow("--verify requires a value");
    expect(() => parseArgs(["--source", "--out", "release"])).toThrow(
      "--source requires a value",
    );
  });

  it("rejects unknown options instead of silently publishing", () => {
    expect(() => parseArgs(["--verfy", "snapshot.json"])).toThrow(
      "unknown option: --verfy",
    );
  });

  it("parses a complete verification command", () => {
    const parsed = parseArgs([
      "--verify",
      "signed-snapshot.json",
      "--public-key",
      "base64-key",
    ]);
    expect(parsed.verifyPath).toBe("signed-snapshot.json");
    expect(parsed.publicKey).toBe("base64-key");
  });
});
