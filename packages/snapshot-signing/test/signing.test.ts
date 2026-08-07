import { describe, it, expect } from "vitest";
import { sampleSnapshot } from "@tradelens/source-adapters/sample";
import { verifySignedSnapshot } from "../src/index.js";
import {
  generateKeyPair,
  publicKeyFromPrivate,
  signSnapshot,
  verifySnapshotNode,
} from "../src/node.js";

describe("snapshot signing", () => {
  const keys = generateKeyPair("test-key-1");

  it("derives the same public key from the private key", () => {
    expect(publicKeyFromPrivate(keys.privateKeyPem)).toBe(keys.publicKeyBase64);
  });

  it("produces an envelope that verifies (node)", () => {
    const signed = signSnapshot(sampleSnapshot, keys.privateKeyPem, keys.keyId);
    expect(signed.algorithm).toBe("ed25519");
    expect(signed.keyId).toBe("test-key-1");
    expect(verifySnapshotNode(signed, keys.publicKeyBase64)).toBe(true);
  });

  it("produces an envelope that verifies (web crypto)", async () => {
    const signed = signSnapshot(sampleSnapshot, keys.privateKeyPem, keys.keyId);
    const result = await verifySignedSnapshot(signed, keys.publicKeyBase64);
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered snapshot", async () => {
    const signed = signSnapshot(sampleSnapshot, keys.privateKeyPem, keys.keyId);
    const tampered = {
      ...signed,
      snapshot: { ...signed.snapshot, revision: signed.snapshot.revision + 1 },
    };
    expect(verifySnapshotNode(tampered, keys.publicKeyBase64)).toBe(false);
    const web = await verifySignedSnapshot(tampered, keys.publicKeyBase64);
    expect(web.valid).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const other = generateKeyPair("other-key");
    const signed = signSnapshot(sampleSnapshot, keys.privateKeyPem, keys.keyId);
    expect(verifySnapshotNode(signed, other.publicKeyBase64)).toBe(false);
    const web = await verifySignedSnapshot(signed, other.publicKeyBase64);
    expect(web.valid).toBe(false);
  });
});
