import { createHash } from "node:crypto";
import type {
  Item,
  SignedSnapshot,
  SourceId,
  ValueSnapshot,
} from "@tradelens/item-schema";
import { parseSnapshot } from "@tradelens/item-schema";
import {
  buildSnapshot,
  mergeSources,
  auditItems,
  type AuditReport,
  type RawRow,
} from "@tradelens/source-adapters";
import { mm2valuesSnapshot } from "@tradelens/source-adapters/mm2values";
import { publicKeyFromPrivate, signSnapshot } from "@tradelens/snapshot-signing/node";

/**
 * Optional signing configuration, read from the environment:
 *   TRADELENS_SIGNING_KEY  — Ed25519 private key PEM (PKCS#8)
 *   TRADELENS_KEY_ID       — identifier published alongside the signature
 * When absent the store serves unsigned snapshots (development only).
 */
interface SigningConfig {
  privateKeyPem: string;
  keyId: string;
  publicKeyBase64: string;
}

function loadSigningConfig(): SigningConfig | undefined {
  const privateKeyPem = process.env.TRADELENS_SIGNING_KEY;
  if (!privateKeyPem) return undefined;
  const keyId = process.env.TRADELENS_KEY_ID ?? "default";
  return {
    privateKeyPem,
    keyId,
    publicKeyBase64: publicKeyFromPrivate(privateKeyPem),
  };
}

/**
 * In-memory snapshot store. A production deployment would back this with a
 * database; here it keeps the current normalised snapshot, its revision, an
 * integrity checksum, and — when a signing key is configured — a cached
 * Ed25519-signed envelope.
 */
class SnapshotStore {
  private snapshot: ValueSnapshot;
  private checksum: string;
  private signing?: SigningConfig;
  private signed?: SignedSnapshot;
  /** Previously published snapshots, oldest first, for rollback. */
  private history: ValueSnapshot[] = [];
  /** A candidate snapshot awaiting explicit review before publishing. */
  private staged?: ValueSnapshot;

  constructor(initial: ValueSnapshot, signing?: SigningConfig) {
    this.signing = signing;
    this.snapshot = parseSnapshot(initial);
    this.checksum = SnapshotStore.hash(this.snapshot);
    this.sign();
  }

  private static hash(snapshot: ValueSnapshot): string {
    return createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");
  }

  private sign(): void {
    this.signed = this.signing
      ? signSnapshot(this.snapshot, this.signing.privateKeyPem, this.signing.keyId)
      : undefined;
  }

  /** Make a snapshot the current one and refresh its checksum and signature. */
  private commit(snapshot: ValueSnapshot): void {
    this.snapshot = snapshot;
    this.checksum = SnapshotStore.hash(snapshot);
    this.sign();
  }

  get(): { snapshot: ValueSnapshot; checksum: string } {
    return { snapshot: this.snapshot, checksum: this.checksum };
  }

  getSigned(): SignedSnapshot | undefined {
    return this.signed;
  }

  getPublicKey(): { keyId: string; publicKeyBase64: string } | undefined {
    if (!this.signing) return undefined;
    return {
      keyId: this.signing.keyId,
      publicKeyBase64: this.signing.publicKeyBase64,
    };
  }

  getItem(id: string): Item | undefined {
    return this.snapshot.items.find((i) => i.id === id);
  }

  /** Audit report for the current published snapshot. */
  audit(): AuditReport {
    return auditItems(this.snapshot.items);
  }

  /** The list of revisions held (history plus the current one). */
  revisions(): number[] {
    return [...this.history.map((s) => s.revision), this.snapshot.revision];
  }

  /** Whether a previous revision is available to roll back to. */
  canRollback(): boolean {
    return this.history.length > 0;
  }

  private buildNext(bySource: Partial<Record<SourceId, RawRow[]>>): ValueSnapshot {
    const items = mergeSources(bySource);
    const sources = Object.keys(bySource) as SourceId[];
    const next = buildSnapshot(items, sources, this.snapshot.revision + 1);
    return parseSnapshot(next);
  }

  /**
   * Build a candidate snapshot from freshly supplied rows and hold it for
   * review. Nothing is published until {@link publish} is called, so an
   * administrator can inspect the audit first.
   */
  stageRows(bySource: Partial<Record<SourceId, RawRow[]>>): {
    revision: number;
    audit: AuditReport;
  } {
    this.staged = this.buildNext(bySource);
    return { revision: this.staged.revision, audit: auditItems(this.staged.items) };
  }

  getStaged(): ValueSnapshot | undefined {
    return this.staged;
  }

  stagedAudit(): AuditReport | undefined {
    return this.staged ? auditItems(this.staged.items) : undefined;
  }

  discardStaged(): void {
    this.staged = undefined;
  }

  /**
   * Publish the staged candidate after review. The previous snapshot is pushed
   * onto the history stack so it can be rolled back to. When `requireClean` is
   * set, publishing is refused while the audit still reports issues.
   */
  publish(options: { requireClean?: boolean } = {}): ValueSnapshot {
    if (!this.staged) throw new Error("nothing staged to publish");
    if (options.requireClean && !auditItems(this.staged.items).clean) {
      throw new Error("staged snapshot has unresolved audit issues");
    }
    this.history.push(this.snapshot);
    const next = this.staged;
    this.staged = undefined;
    this.commit(next);
    return this.snapshot;
  }

  /** Restore the most recent previous revision. */
  rollback(): ValueSnapshot {
    const prev = this.history.pop();
    if (!prev) throw new Error("no previous revision to roll back to");
    this.commit(prev);
    return this.snapshot;
  }

  /**
   * Administrator import fallback: replace the snapshot from freshly supplied
   * per-source rows. Everything is validated before it is accepted. The prior
   * snapshot is retained so this import can also be rolled back.
   */
  importRows(bySource: Partial<Record<SourceId, RawRow[]>>): ValueSnapshot {
    const next = this.buildNext(bySource);
    this.history.push(this.snapshot);
    this.commit(next);
    return this.snapshot;
  }
}

export const store = new SnapshotStore(mm2valuesSnapshot, loadSigningConfig());
