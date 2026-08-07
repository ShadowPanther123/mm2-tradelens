import type { SnapshotMeta, ValueSnapshot } from "@/types";
import { getStorage } from "@/services/storage";

/** Read the cached snapshot, or null when nothing is cached. */
export function getCachedSnapshot(): Promise<ValueSnapshot | null> {
  return getStorage().getCachedSnapshot();
}

/** Read metadata about the cached snapshot. */
export function getSnapshotMeta(): Promise<SnapshotMeta | null> {
  return getStorage().getSnapshotMeta();
}

/**
 * Read an externally-published snapshot dropped into the app data directory by
 * the local publish step, or null when none is present.
 */
export function readExternalSnapshot(): Promise<ValueSnapshot | null> {
  return getStorage().readExternalSnapshot();
}

/** Cache a snapshot (seed data or a downloaded feed). */
export function saveSnapshot(snapshot: ValueSnapshot): Promise<void> {
  return getStorage().saveSnapshot(snapshot);
}
