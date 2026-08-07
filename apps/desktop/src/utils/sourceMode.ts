import type { EngineSourceMode, SourceMode } from "@/types";

/**
 * Map an app-level source mode to the engine's calculation mode.
 *
 * "compare-both" is a display-only preference (both approved sources shown
 * independently), so any single-figure calculation falls back to the labelled
 * "consensus" derived estimate — the source values themselves are never hidden
 * or silently merged.
 */
export function toEngineMode(mode: SourceMode): EngineSourceMode {
  return mode === "compare-both" ? "consensus" : mode;
}

/**
 * Human-readable label for a source mode. The internal `"consensus"`
 * identifier is presented to users as "Combined estimate".
 */
export function sourceModeLabel(mode: SourceMode): string {
  switch (mode) {
    case "consensus":
      return "Combined estimate";
    case "compare-both":
      return "Compare both";
    case "supreme":
      return "Supreme Values";
    case "mm2values":
      return "MM2Values";
    case "community":
      return "Community";
    default:
      return mode;
  }
}
