import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import {
  canonicaliseSnapshot,
  parseSnapshot,
  type SignedSnapshot,
  type ValueSnapshot,
} from "@tradelens/item-schema";

/**
 * Node-only Ed25519 signing for value snapshots. Used by the updater and the
 * values-api to produce the signed artefact the client verifies. Kept separate
 * from the browser-safe verifier so `node:crypto` never reaches the client
 * bundle.
 */

/** A generated Ed25519 key pair, encoded for storage/distribution. */
export interface GeneratedKeyPair {
  keyId: string;
  /** PKCS#8 PEM — keep secret, used only by the signer. */
  privateKeyPem: string;
  /** Raw 32-byte public key, base64 — safe to bundle in the client. */
  publicKeyBase64: string;
}

/** Extract the raw 32-byte public key from an Ed25519 key object. */
function rawPublicKeyBase64(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("could not extract Ed25519 public key");
  // JWK "x" is base64url; convert to standard base64.
  const base64url = jwk.x;
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return base64 + pad;
}

/** Generate a fresh Ed25519 key pair for snapshot signing. */
export function generateKeyPair(keyId: string): GeneratedKeyPair {
  if (!keyId) throw new Error("keyId is required");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    keyId,
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyBase64: rawPublicKeyBase64(publicKey),
  };
}

/** Derive the distributable raw public key (base64) from a private key PEM. */
export function publicKeyFromPrivate(privateKeyPem: string): string {
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem));
  return rawPublicKeyBase64(publicKey);
}

/**
 * Sign a snapshot, producing a {@link SignedSnapshot} envelope. The snapshot is
 * validated before signing so an invalid payload can never be published.
 */
export function signSnapshot(
  snapshot: ValueSnapshot,
  privateKeyPem: string,
  keyId: string,
): SignedSnapshot {
  const validated = parseSnapshot(snapshot);
  const key = createPrivateKey(privateKeyPem);
  const message = Buffer.from(canonicaliseSnapshot(validated), "utf8");
  // Ed25519 signs the message directly (no pre-hash), so the digest arg is null.
  const signature = nodeSign(null, message, key);
  return {
    algorithm: "ed25519",
    keyId,
    signature: signature.toString("base64"),
    snapshot: validated,
  };
}

/** A detached Ed25519 signature over arbitrary bytes (e.g. a checksum file). */
export interface DetachedSignature {
  algorithm: "ed25519";
  keyId: string;
  /** Base64 Ed25519 signature over the raw message bytes. */
  signature: string;
}

/**
 * Sign arbitrary bytes (not a snapshot), producing a detached signature. Used to
 * make release metadata such as a SHA-256 checksum manifest tamper-evident.
 */
export function signBytes(
  message: Buffer | string,
  privateKeyPem: string,
  keyId: string,
): DetachedSignature {
  const key = createPrivateKey(privateKeyPem);
  const bytes = typeof message === "string" ? Buffer.from(message, "utf8") : message;
  const signature = nodeSign(null, bytes, key);
  return { algorithm: "ed25519", keyId, signature: signature.toString("base64") };
}

/** Node-side verification, mainly for tests and server-side re-checks. */
export function verifySnapshotNode(signed: SignedSnapshot, publicKeyBase64: string): boolean {
  if (signed.algorithm !== "ed25519") return false;
  try {
    const raw = Buffer.from(publicKeyBase64, "base64");
    const publicKey = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: raw.toString("base64url"),
      },
      format: "jwk",
    });
    const message = Buffer.from(canonicaliseSnapshot(signed.snapshot), "utf8");
    return nodeVerify(null, message, publicKey, Buffer.from(signed.signature, "base64"));
  } catch {
    return false;
  }
}
