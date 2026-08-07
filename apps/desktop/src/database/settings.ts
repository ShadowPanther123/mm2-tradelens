import type { Settings } from "@/types";
import { getStorage } from "@/services/storage";

/** Read persisted settings from the active storage backend. */
export function getSettings(): Promise<Settings> {
  return getStorage().getSettings();
}

/** Persist the full settings object. */
export function updateSettings(settings: Settings): Promise<void> {
  return getStorage().updateSettings(settings);
}
