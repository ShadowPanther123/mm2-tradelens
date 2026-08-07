/**
 * Detect whether the frontend is running inside the Tauri shell. Tauri v2
 * injects `__TAURI_INTERNALS__` onto `window`; checking for it is synchronous
 * and safe in a plain browser, where `window` exists but the marker does not.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
