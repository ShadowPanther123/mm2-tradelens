import { useMemo } from "react";
import {
  evaluateTrade,
  type TradeLine,
  type TradeResult,
} from "@tradelens/trade-engine";
import { useDataStore } from "./useDataStore";
import { useTradeStore } from "./useTradeStore";
import type { Item, TradeSlot } from "@/types";
import { toEngineMode } from "@/utils/sourceMode";

function toLines(
  slots: TradeSlot[],
  itemById: (id: string) => Item | undefined,
): TradeLine[] {
  const lines: TradeLine[] = [];
  for (const slot of slots) {
    const item = itemById(slot.itemId);
    if (item) lines.push({ item, quantity: slot.quantity });
  }
  return lines;
}

/** Live trade evaluation for the current calculator state + source mode. */
export function useTradeResult(): TradeResult {
  const your = useTradeStore((s) => s.your);
  const their = useTradeStore((s) => s.their);
  const sourceMode = useDataStore((s) => s.settings.sourceMode);
  const itemById = useDataStore((s) => s.itemById);

  return useMemo(() => {
    const yourLines = toLines(your, itemById);
    const theirLines = toLines(their, itemById);
    return evaluateTrade(yourLines, theirLines, toEngineMode(sourceMode));
  }, [your, their, sourceMode, itemById]);
}
