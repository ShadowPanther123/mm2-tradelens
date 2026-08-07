import { invokeCommand } from "@/services/commands";
import type { AppInfo, ValueSnapshot } from "@/types";
import type { StorageAdapter } from "./types";

/**
 * Native storage backend. Every method forwards to a typed Tauri command that
 * persists to the Rust-managed SQLite database.
 */
export const tauriStorage: StorageAdapter = {
  kind: "tauri",

  getSettings: () => invokeCommand("get_settings"),
  updateSettings: (settings) => invokeCommand("update_settings", { settings }),

  listFavorites: () => invokeCommand("list_favorites"),
  addFavorite: (itemId, baselineValue) =>
    invokeCommand("add_favorite", { itemId, baselineValue }),
  removeFavorite: (itemId) => invokeCommand("remove_favorite", { itemId }),

  listHistory: () => invokeCommand("list_history"),
  addHistoryRecord: (record) => invokeCommand("add_history_record", { record }),
  removeHistoryRecord: (id) => invokeCommand("remove_history_record", { id }),

  getCachedSnapshot: () => invokeCommand("get_snapshot"),
  getSnapshotMeta: () => invokeCommand("get_snapshot_meta"),
  readExternalSnapshot: () => invokeCommand("read_external_snapshot"),
  saveSnapshot: (snapshot: ValueSnapshot) =>
    invokeCommand("save_snapshot", {
      revision: snapshot.revision,
      generatedAt: snapshot.generatedAt,
      payload: snapshot,
    }),

  getAppInfo: (): Promise<AppInfo> => invokeCommand("app_info"),
  clearAllData: () => invokeCommand("clear_all_data"),
};
