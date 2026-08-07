import {
  canonicaliseSnapshot,
  type SignedSnapshot,
  type ValueSnapshot,
} from "@tradelens/item-schema";

/**
 * Browser-safe (Web Crypto) Ed25519 signature verification for value
 * snapshots. This module contains no Node built-ins so it can be bundled into
 * the desktop client and the browser extension. Signing lives in `./node`.
 */

/** Result of verifying a signed snapshot envelope. */
export interface VerifyResult {
  valid: boolean;
  /** Present when `valid` is false. */
  reason?: string;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Import a raw 32-byte Ed25519 public key (base64) for verification. */
async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(publicKeyBase64);
  return crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, [
    "verify",
  ]);
}

/**
 * Verify that `signed.signature` is a valid Ed25519 signature over the
 * canonical bytes of `signed.snapshot`, produced by `publicKeyBase64`.
 *
 * Never throws — any failure (including environments without Ed25519 support)
 * resolves to `{ valid: false, reason }` so callers can fail closed.
 */
export async function verifySignedSnapshot(
  signed: SignedSnapshot,
  publicKeyBase64: string,
): Promise<VerifyResult> {
  if (signed.algorithm !== "ed25519") {
    return { valid: false, reason: `unsupported algorithm: ${signed.algorithm}` };
  }
  try {
    const key = await importPublicKey(publicKeyBase64);
    const message = new TextEncoder().encode(
      canonicaliseSnapshot(signed.snapshot),
    );
    const signature = base64ToBytes(signed.signature);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature,
      message,
    );
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
}

export { canonicaliseSnapshot };
export type { SignedSnapshot, ValueSnapshot };
