import { create } from "zustand";
import type { TradeSlot } from "@/types";

type Side = "your" | "their";

/**
 * Largest quantity allowed per line. Matches the Rust persistence limit
 * (`MAX_QUANTITY`) so anything that can be entered can also be saved, and it
 * keeps line totals far below `Number.MAX_SAFE_INTEGER` to avoid overflow.
 */
export const MAX_QUANTITY = 10_000;

/** Clamp a requested quantity to a positive whole number within bounds. */
function normalizeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  const whole = Math.floor(quantity);
  if (whole < 1) return 1;
  if (whole > MAX_QUANTITY) return MAX_QUANTITY;
  return whole;
}

interface TradeState {
  your: TradeSlot[];
  their: TradeSlot[];
  add: (side: Side, itemId: string) => void;
  remove: (side: Side, itemId: string) => void;
  setQuantity: (side: Side, itemId: string, quantity: number) => void;
  clear: () => void;
}

function addSlot(slots: TradeSlot[], itemId: string): TradeSlot[] {
  const existing = slots.find((s) => s.itemId === itemId);
  if (existing) {
    return slots.map((s) =>
      s.itemId === itemId
        ? { ...s, quantity: normalizeQuantity(s.quantity + 1) }
        : s,
    );
  }
  return [...slots, { itemId, quantity: 1 }];
}

/** Ephemeral working state for the trade calculator (not persisted). */
export const useTradeStore = create<TradeState>((set) => ({
  your: [],
  their: [],
  add: (side, itemId) => set((s) => ({ [side]: addSlot(s[side], itemId) }) as Partial<TradeState>),
  remove: (side, itemId) =>
    set((s) => ({ [side]: s[side].filter((x) => x.itemId !== itemId) }) as Partial<TradeState>),
  setQuantity: (side, itemId, quantity) =>
    set(
      (s) =>
        ({
          [side]: s[side].map((x) =>
            x.itemId === itemId
              ? { ...x, quantity: normalizeQuantity(quantity) }
              : x,
          ),
        }) as Partial<TradeState>,
    ),
  clear: () => set({ your: [], their: [] }),
}));
