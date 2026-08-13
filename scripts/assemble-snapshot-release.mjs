// @ts-check
import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = {
    snapshot: join(root, "packages", "source-adapters", "src", "mm2values-snapshot.json"),
    assets: join(root, "apps", "desktop", "public"),
    out: join(root, "out", "snapshot-release"),
    key: "",
    keyId: "mm2-tradelens-2026-08",
    minimumRevision: 17,
  };
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i] ?? "";
    if (argv[i] === "--snapshot") args.snapshot = resolve(value());
    else if (argv[i] === "--assets") args.assets = resolve(value());
    else if (argv[i] === "--out") args.out = resolve(value());
    else if (argv[i] === "--key") args.key = resolve(value());
    else if (argv[i] === "--key-id") args.keyId = value();
    else if (argv[i] === "--minimum-revision") args.minimumRevision = Number(value());
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function signBytes(bytes, privateKey, keyId) {
  return {
    algorithm: "ed25519",
    keyId,
    signature: sign(null, bytes, privateKey).toString("base64"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key || !existsSync(args.key)) throw new Error("--key must point to an Ed25519 PEM");
  const snapshot = JSON.parse(readFileSync(args.snapshot, "utf8"));
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < args.minimumRevision) {
    throw new Error(
      `Snapshot revision ${snapshot.revision} is below minimum ${args.minimumRevision}`,
    );
  }

  const parent = dirname(args.out);
  mkdirSync(parent, { recursive: true });
  const staging = join(parent, `.${basename(args.out)}-${process.pid}-${Date.now()}`);
  const backup = `${args.out}.previous`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "v1"), { recursive: true });

  const privateKey = createPrivateKey(readFileSync(args.key, "utf8"));
  const snapshotBody = JSON.stringify(snapshot);
  const signedSnapshot = {
    algorithm: "ed25519",
    keyId: args.keyId,
    signature: sign(null, Buffer.from(canonical(snapshot)), privateKey).toString("base64"),
    snapshot,
  };
  writeFileSync(join(staging, "v1", "snapshot"), snapshotBody);
  writeFileSync(join(staging, "v1", "signed-snapshot"), JSON.stringify(signedSnapshot));
  writeFileSync(join(staging, "v1", "revision"), `${JSON.stringify({ revision: snapshot.revision })}\n`);

  const referencedAssets = [...new Set(snapshot.items.map((item) => item.image).filter(Boolean))];
  for (const asset of referencedAssets) {
    if (typeof asset !== "string" || asset.includes("..") || asset.startsWith("/") || /^[a-z]+:/i.test(asset))
      throw new Error(`Unsafe asset reference: ${String(asset)}`);
    const source = join(args.assets, asset);
    if (!existsSync(source)) throw new Error(`Missing snapshot asset: ${asset}`);
    const target = join(staging, asset);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }

  const payloadFiles = walk(staging).sort();
  const entries = payloadFiles.map((file) => ({
    path: relative(staging, file).replaceAll("\\", "/"),
    bytes: readFileSync(file).length,
    sha256: sha256(readFileSync(file)),
  }));
  const manifest = {
    schemaVersion: 1,
    revision: snapshot.revision,
    generatedAt: snapshot.generatedAt,
    publishedAt: new Date().toISOString(),
    assets: referencedAssets.length,
    files: entries,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(staging, "release-manifest.json"), manifestBytes);
  writeFileSync(
    join(staging, "release-manifest.sig.json"),
    `${JSON.stringify(signBytes(manifestBytes, privateKey, args.keyId), null, 2)}\n`,
  );

  const checksums = walk(staging)
    .sort()
    .map((file) => `${sha256(readFileSync(file))}  ${relative(staging, file).replaceAll("\\", "/")}`)
    .join("\n");
  writeFileSync(join(staging, "SHA256SUMS"), `${checksums}\n`);

  rmSync(backup, { recursive: true, force: true });
  if (existsSync(args.out)) renameSync(args.out, backup);
  try {
    renameSync(staging, args.out);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(args.out) && existsSync(backup)) renameSync(backup, args.out);
    throw error;
  }
  console.log(
    `Assembled atomic revision ${snapshot.revision} release with ${referencedAssets.length} assets.`,
  );
}

main();
