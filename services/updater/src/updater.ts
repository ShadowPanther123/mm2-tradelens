import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSnapshot, safeParseSignedSnapshot } from "@tradelens/item-schema";
import { auditItems, formatAuditReport } from "@tradelens/source-adapters";
import { mm2valuesSnapshot } from "@tradelens/source-adapters/mm2values";
import {
  generateKeyPair,
  publicKeyFromPrivate,
  signBytes,
  signSnapshot,
  verifySnapshotNode,
} from "@tradelens/snapshot-signing/node";

/**
 * TradeLens updater.
 *
 * Produces the signed snapshot artefact the desktop app downloads and caches
 * offline. It validates the schema, runs the data audit, and — when a signing
 * key is supplied — writes an Ed25519-signed envelope plus a SHA-256 checksum
 * so the client can verify integrity and authenticity.
 *
 * Usage:
 *   node dist/updater.js [--source https://…/v1/snapshot] [--out ./out]
 *                        [--key ./signing.pem] [--key-id 2026-07]
 *                        [--fail-on-audit]
 *   node dist/updater.js --keygen [--key-id 2026-07] [--out ./out]
 *   node dist/updater.js --verify ./signed-snapshot.json --public-key <base64>
 */

interface Options {
  source?: string;
  outDir: string;
  keyPath?: string;
  keyId: string;
  keygen: boolean;
  failOnAudit: boolean;
  verifyPath?: string;
  publicKey?: string;
  signFilePath?: string;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    outDir: "out",
    keyId: "default",
    keygen: false,
    failOnAudit: false,
  };
  const valueAfter = (name: string, index: number): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source") opts.source = valueAfter(arg, i++);
    else if (arg === "--out") opts.outDir = valueAfter(arg, i++);
    else if (arg === "--key") opts.keyPath = valueAfter(arg, i++);
    else if (arg === "--key-id") opts.keyId = valueAfter(arg, i++);
    else if (arg === "--keygen") opts.keygen = true;
    else if (arg === "--fail-on-audit") opts.failOnAudit = true;
    else if (arg === "--verify") opts.verifyPath = valueAfter(arg, i++);
    else if (arg === "--public-key") opts.publicKey = valueAfter(arg, i++);
    else if (arg === "--sign-file") opts.signFilePath = valueAfter(arg, i++);
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

async function fetchSnapshot(source: string): Promise<unknown> {
  if (!source.startsWith("https://") && !source.startsWith("http://localhost")) {
    throw new Error(
      `refusing to fetch snapshot over an insecure URL: ${source} (use HTTPS)`,
    );
  }
  const res = await fetch(source);
  if (!res.ok) throw new Error(`source responded ${res.status}`);
  return res.json();
}

function runKeygen(opts: Options): void {
  const pair = generateKeyPair(opts.keyId);
  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(`${opts.outDir}/signing.pem`, pair.privateKeyPem, { mode: 0o600 });
  writeFileSync(`${opts.outDir}/public-key.txt`, `${pair.publicKeyBase64}\n`);
  // eslint-disable-next-line no-console
  console.log(`Generated key "${pair.keyId}".`);
  // eslint-disable-next-line no-console
  console.log(`Private key: ${opts.outDir}/signing.pem (keep secret)`);
  // eslint-disable-next-line no-console
  console.log(`Public key (bundle in client): ${pair.publicKeyBase64}`);
}

/** Verify a previously produced signed snapshot and audit its contents. */
function runVerify(opts: Options): void {
  if (!opts.publicKey) {
    throw new Error("--verify requires --public-key <base64>");
  }
  const raw = JSON.parse(readFileSync(opts.verifyPath!, "utf8")) as unknown;
  const parsed = safeParseSignedSnapshot(raw);
  if (!parsed.success) {
    throw new Error("signed snapshot failed schema validation");
  }
  // eslint-disable-next-line no-console
  console.log("schema: ok");

  if (!verifySnapshotNode(parsed.data, opts.publicKey)) {
    throw new Error("signature verification failed");
  }
  // eslint-disable-next-line no-console
  console.log("signature: ok");

  const { snapshot } = parsed.data;
  const report = auditItems(snapshot.items, { requiredSources: snapshot.sources });
  // eslint-disable-next-line no-console
  console.log(formatAuditReport(report));
  if (!report.clean) {
    throw new Error("signed snapshot has unresolved data-audit issues");
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.keygen) {
    runKeygen(opts);
    return;
  }

  if (opts.verifyPath) {
    runVerify(opts);
    return;
  }

  if (opts.signFilePath) {
    if (!opts.keyPath) throw new Error("--sign-file requires --key <pem>");
    const bytes = readFileSync(opts.signFilePath);
    const detached = signBytes(bytes, readFileSync(opts.keyPath, "utf8"), opts.keyId);
    writeFileSync(`${opts.signFilePath}.sig.json`, `${JSON.stringify(detached, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`Signed ${opts.signFilePath} → ${opts.signFilePath}.sig.json (key "${opts.keyId}").`);
    return;
  }

  const raw = opts.source ? await fetchSnapshot(opts.source) : mm2valuesSnapshot;
  // Validate before publishing — never ship data that fails the schema.
  const snapshot = parseSnapshot(raw);

  // Audit before publishing so problems are visible (and optionally blocking).
  const report = auditItems(snapshot.items, { requiredSources: snapshot.sources });
  // eslint-disable-next-line no-console
  console.log(formatAuditReport(report));
  if (opts.failOnAudit && !report.clean) {
    throw new Error(
      "data audit reported issues; refusing to publish (--fail-on-audit)",
    );
  }

  mkdirSync(opts.outDir, { recursive: true });
  const body = JSON.stringify(snapshot);
  const checksum = createHash("sha256").update(body).digest("hex");
  writeFileSync(`${opts.outDir}/snapshot.json`, body);
  writeFileSync(`${opts.outDir}/snapshot.sha256`, `${checksum}  snapshot.json\n`);

  if (opts.keyPath) {
    const privateKeyPem = readFileSync(opts.keyPath, "utf8");
    const signed = signSnapshot(snapshot, privateKeyPem, opts.keyId);
    writeFileSync(`${opts.outDir}/signed-snapshot.json`, JSON.stringify(signed));
    // eslint-disable-next-line no-console
    console.log(
      `Signed snapshot with key "${opts.keyId}" (public ${publicKeyFromPrivate(privateKeyPem)}).`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "No --key supplied: wrote an UNSIGNED snapshot. Production feeds must be signed.",
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `Published snapshot rev ${snapshot.revision} (${snapshot.items.length} items) to ${opts.outDir}/`,
  );
  // eslint-disable-next-line no-console
  console.log(`sha256: ${checksum}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("updater failed:", (err as Error).message);
    process.exit(1);
  });
}
