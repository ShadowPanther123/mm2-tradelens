import { invoke } from "@tauri-apps/api/core";
import { safeParseSnapshot } from "@tradelens/item-schema";
import type {
  AppInfo,
  Favorite,
  HistoryPoint,
  OverlaySize,
  Settings,
  SnapshotMeta,
  TradeRecord,
  ValueSnapshot,
} from "@/types";

/**
 * Single source of truth for every native command the frontend can invoke.
 * Each entry declares its argument and result types, so call sites are checked
 * at compile time and command names cannot drift or be duplicated.
 */
export interface CommandMap {
  get_settings: { args: undefined; result: Settings };
  update_settings: { args: { settings: Settings }; result: void };

  list_favorites: { args: undefined; result: Favorite[] };
  add_favorite: { args: { itemId: string; baselineValue: number }; result: void };
  remove_favorite: { args: { itemId: string }; result: void };
  is_favorite: { args: { itemId: string }; result: boolean };

  list_history: { args: undefined; result: TradeRecord[] };
  add_history_record: { args: { record: TradeRecord }; result: void };
  remove_history_record: { args: { id: string }; result: void };

  get_snapshot: { args: undefined; result: ValueSnapshot | null };
  get_snapshot_meta: { args: undefined; result: SnapshotMeta | null };
  read_external_snapshot: { args: undefined; result: ValueSnapshot | null };
  save_snapshot: {
    args: { revision: number; generatedAt: string; payload: ValueSnapshot };
    result: void;
  };

  record_value_history: { args: { points: HistoryPoint[] }; result: number };
  get_value_history: {
    args: { itemId: string; limit?: number };
    result: HistoryPoint[];
  };

  app_info: { args: undefined; result: AppInfo };
  set_overlay_size: { args: { size: OverlaySize }; result: void };
  set_always_on_top: { args: { enabled: boolean }; result: void };
  clear_all_data: { args: undefined; result: void };
  reset_database: { args: undefined; result: void };
  focus_window: { args: undefined; result: void };
}

export type CommandName = keyof CommandMap;

/**
 * Optional runtime guards for command responses. The native layer is trusted,
 * but validating the boundary catches schema drift between the Rust and
 * TypeScript definitions early instead of letting a malformed value propagate.
 */
const responseValidators: {
  [K in CommandName]?: (value: unknown) => CommandMap[K]["result"];
} = {
  get_snapshot: (value) => {
    if (value === null) return null;
    const parsed = safeParseSnapshot(value);
    if (!parsed.success) {
      throw new Error(`get_snapshot returned an invalid snapshot: ${parsed.error.message}`);
    }
    return parsed.data as ValueSnapshot;
  },
  read_external_snapshot: (value) => {
    if (value === null) return null;
    const parsed = safeParseSnapshot(value);
    if (!parsed.success) {
      throw new Error(
        `read_external_snapshot returned an invalid snapshot: ${parsed.error.message}`,
      );
    }
    return parsed.data as ValueSnapshot;
  },
  get_settings: (value) => {
    if (!value || typeof value !== "object") {
      throw new Error("get_settings returned a non-object response");
    }
    return value as Settings;
  },
  list_favorites: (value) => {
    if (!Array.isArray(value)) throw new Error("list_favorites did not return an array");
    return value as Favorite[];
  },
  list_history: (value) => {
    if (!Array.isArray(value)) throw new Error("list_history did not return an array");
    return value as TradeRecord[];
  },
};

/**
 * Validate (and narrow) a raw command response against any registered guard.
 * Exposed separately so the boundary logic can be unit-tested without a live
 * Tauri runtime.
 */
export function validateResponse<K extends CommandName>(
  name: K,
  value: unknown,
): CommandMap[K]["result"] {
  const validate = responseValidators[name] as
    | ((value: unknown) => CommandMap[K]["result"])
    | undefined;
  return validate ? validate(value) : (value as CommandMap[K]["result"]);
}

/**
 * Type-safe wrapper around Tauri's `invoke`. The command name is constrained to
 * the {@link CommandMap}, arguments and result are inferred, and any registered
 * response validator runs before the value reaches the caller.
 */
export async function invokeCommand<K extends CommandName>(
  name: K,
  args?: CommandMap[K]["args"],
): Promise<CommandMap[K]["result"]> {
  const raw = await invoke(name, args as Record<string, unknown> | undefined);
  return validateResponse(name, raw);
}
