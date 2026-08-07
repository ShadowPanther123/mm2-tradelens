import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { OverlaySize } from "@/types";
import { invokeCommand } from "@/services/commands";
import { isTauriRuntime } from "@/services/storage";

/**
 * Bridge to native window features. Everything here is Tauri-only; when the app
 * runs in a plain browser these degrade to safe no-ops so the shared UI still
 * works. Persistence goes through `@/services/storage`, not this module.
 */

/** No-op unlisten used when running outside the Tauri shell. */
const noopUnlisten: UnlistenFn = () => undefined;

/** Subscribe to the global hotkey toggle event emitted by Rust. */
export function onToggleOverlay(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return Promise.resolve(noopUnlisten);
  return listen("toggle-overlay", () => handler());
}

/** Ask the native layer to resize the window for a given overlay size. */
export function setOverlaySize(size: OverlaySize): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  return invokeCommand("set_overlay_size", { size });
}

/** Toggle the always-on-top flag on the main window. */
export function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  return invokeCommand("set_always_on_top", { enabled });
}

/** Bring the window forward. */
export function focusWindow(): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  return invokeCommand("focus_window");
}

/** Native window controls used by the custom title bar (no-ops in a browser). */
export const windowControls = {
  minimize: () => (isTauriRuntime() ? getCurrentWindow().minimize() : Promise.resolve()),
  toggleMaximize: () =>
    isTauriRuntime() ? getCurrentWindow().toggleMaximize() : Promise.resolve(),
  close: () => (isTauriRuntime() ? getCurrentWindow().close() : Promise.resolve()),
  startDragging: () =>
    isTauriRuntime() ? getCurrentWindow().startDragging() : Promise.resolve(),
};
