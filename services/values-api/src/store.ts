import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
export interface SigningConfig {
  privateKeyPem: string;
  keyId: string;
  publicKeyBase64: string;
}

interface PersistedState {
  version: 1;
  snapshot: ValueSnapshot;
  history: ValueSnapshot[];
  staged?: ValueSnapshot;
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
 * Snapshot store with atomic JSON persistence. The state file retains the
 * current snapshot, staged candidate and rollback history across restarts.
 */
export class SnapshotStore {
  private snapshot: ValueSnapshot;
  private checksum: string;
  private signing?: SigningConfig;
  private signed?: SignedSnapshot;
  /** Previously published snapshots, oldest first, for rollback. */
  private history: ValueSnapshot[] = [];
  /** A candidate snapshot awaiting explicit review before publishing. */
  private staged?: ValueSnapshot;
  private persistenceFile?: string;

  constructor(initial: ValueSnapshot, signing?: SigningConfig, persistenceFile?: string) {
    this.signing = signing;
    this.persistenceFile = persistenceFile;
    const persisted = this.loadPersisted();
    this.snapshot = parseSnapshot(persisted?.snapshot ?? initial);
    this.history = (persisted?.history ?? []).map((entry) => parseSnapshot(entry));
    this.staged = persisted?.staged ? parseSnapshot(persisted.staged) : undefined;
    this.checksum = SnapshotStore.hash(this.snapshot);
    this.sign();
  }

  private loadPersisted(): PersistedState | undefined {
    if (!this.persistenceFile || !existsSync(this.persistenceFile)) return undefined;
    const raw = JSON.parse(readFileSync(this.persistenceFile, "utf8")) as PersistedState;
    if (raw.version !== 1 || !Array.isArray(raw.history)) {
      throw new Error(`unsupported values-api state file: ${this.persistenceFile}`);
    }
    return raw;
  }

  private persist(
    snapshot: ValueSnapshot,
    history: ValueSnapshot[],
    staged: ValueSnapshot | undefined,
  ): void {
    if (!this.persistenceFile) return;
    mkdirSync(dirname(this.persistenceFile), { recursive: true });
    const temp = `${this.persistenceFile}.${process.pid}.tmp`;
    const state: PersistedState = { version: 1, snapshot, history, staged };
    writeFileSync(temp, `${JSON.stringify(state)}\n`, "utf8");
    renameSync(temp, this.persistenceFile);
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
  private commit(
    snapshot: ValueSnapshot,
    history: ValueSnapshot[],
    staged: ValueSnapshot | undefined,
  ): void {
    const parsed = parseSnapshot(snapshot);
    this.persist(parsed, history, staged);
    this.snapshot = parsed;
    this.history = history;
    this.staged = staged;
    this.checksum = SnapshotStore.hash(parsed);
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
    const staged = this.buildNext(bySource);
    this.persist(this.snapshot, this.history, staged);
    this.staged = staged;
    return { revision: staged.revision, audit: auditItems(staged.items) };
  }

  getStaged(): ValueSnapshot | undefined {
    return this.staged;
  }

  stagedAudit(): AuditReport | undefined {
    return this.staged ? auditItems(this.staged.items) : undefined;
  }

  discardStaged(): void {
    this.persist(this.snapshot, this.history, undefined);
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
    const next = this.staged;
    this.commit(next, [...this.history, this.snapshot], undefined);
    return this.snapshot;
  }

  /** Restore previous content under a new revision so clients can adopt it. */
  rollback(): ValueSnapshot {
    const prev = this.history.at(-1);
    if (!prev) throw new Error("no previous revision to roll back to");
    const remaining = this.history.slice(0, -1);
    const restored = parseSnapshot({
      ...prev,
      revision: this.snapshot.revision + 1,
      generatedAt: new Date().toISOString(),
    });
    this.commit(restored, remaining, undefined);
    return this.snapshot;
  }

  /**
   * Administrator import fallback: replace the snapshot from freshly supplied
   * per-source rows. Everything is validated before it is accepted. The prior
   * snapshot is retained so this import can also be rolled back.
   */
  importRows(bySource: Partial<Record<SourceId, RawRow[]>>): ValueSnapshot {
    const next = this.buildNext(bySource);
    this.commit(next, [...this.history, this.snapshot], this.staged);
    return this.snapshot;
  }
}

function defaultPersistenceFile(): string | undefined {
  if (process.env.NODE_ENV === "test") return undefined;
  if (process.env.TRADELENS_DATA_FILE === "") return undefined;
  return resolve(process.env.TRADELENS_DATA_FILE ?? "data/local/values-api-state.json");
}

export const store = new SnapshotStore(
  mm2valuesSnapshot,
  loadSigningConfig(),
  defaultPersistenceFile(),
);
