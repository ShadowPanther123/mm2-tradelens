import type { AppInfo } from "@/types";
import { getStorage } from "@/services/storage";
import { invokeCommand } from "@/services/commands";
import { isTauriRuntime } from "@/services/storage";

export * from "./settings";
export * from "./favorites";
export * from "./history";
export * from "./snapshot";
export * from "./valueHistory";

/** Read basic app metadata. */
export function getAppInfo(): Promise<AppInfo> {
  return getStorage().getAppInfo();
}

/** Delete all local data and reset settings to defaults. */
export function clearAllData(): Promise<void> {
  return getStorage().clearAllData();
}

/**
 * Safe database reset: rebuild the schema from scratch (native only). Falls
 * back to clearing local data in browser mode, where there is no schema.
 */
export function resetDatabase(): Promise<void> {
  if (isTauriRuntime()) return invokeCommand("reset_database");
  return getStorage().clearAllData();
}
