import { createBrowserStorage } from "./browserAdapter";
import { isTauriRuntime } from "./runtime";
import { tauriStorage } from "./tauriAdapter";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";
export { isTauriRuntime } from "./runtime";

let active: StorageAdapter | null = null;

/**
 * Return the storage backend for the current runtime, choosing automatically:
 * the native Tauri SQLite adapter inside the desktop shell, or the browser
 * `localStorage` adapter otherwise. The choice is memoised for the session.
 */
export function getStorage(): StorageAdapter {
  if (active) return active;
  if (isTauriRuntime()) {
    active = tauriStorage;
  } else {
    if (typeof window === "undefined" || !window.localStorage) {
      throw new Error("No storage backend available: not running in Tauri and no localStorage.");
    }
    active = createBrowserStorage(window.localStorage);
    console.warn(
      "[storage] Running outside the Tauri shell — using browser localStorage. " +
        "Data is stored in this browser only and native features are unavailable.",
    );
  }
  return active;
}

/** Test seam: override the active adapter. */
export function __setStorageForTests(adapter: StorageAdapter | null): void {
  active = adapter;
}
