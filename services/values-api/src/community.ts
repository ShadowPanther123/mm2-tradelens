import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CommunitySlot {
  itemId: string;
  quantity: number;
}

export interface CommunityTrade {
  id: string;
  createdAt: string;
  gave: CommunitySlot[];
  received: CommunitySlot[];
  difference: number;
  resultPercent: number;
}

const MAX_TRADES = 2_000;
const MAX_QUANTITY = 10_000;
const MAX_VALUE = 1e15;

function validSlot(value: unknown): value is CommunitySlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<CommunitySlot>;
  return (
    typeof slot.itemId === "string" &&
    /^[a-z0-9-]{1,64}$/.test(slot.itemId) &&
    typeof slot.quantity === "number" &&
    Number.isInteger(slot.quantity) &&
    slot.quantity >= 1 &&
    slot.quantity <= MAX_QUANTITY
  );
}

export class CommunityTradeStore {
  private trades: CommunityTrade[] = [];

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { trades?: CommunityTrade[] };
      if (Array.isArray(parsed.trades)) this.trades = parsed.trades.slice(0, MAX_TRADES);
    }
  }

  list(limit = 100): CommunityTrade[] {
    return this.trades.slice(0, Math.min(100, Math.max(1, Math.floor(limit))));
  }

  add(input: unknown): CommunityTrade {
    if (!input || typeof input !== "object") throw new Error("invalid trade");
    const body = input as Partial<CommunityTrade>;
    if (
      !Array.isArray(body.gave) ||
      !Array.isArray(body.received) ||
      body.gave.length === 0 ||
      body.received.length === 0 ||
      body.gave.length > 32 ||
      body.received.length > 32 ||
      !body.gave.every(validSlot) ||
      !body.received.every(validSlot) ||
      typeof body.difference !== "number" ||
      !Number.isFinite(body.difference) ||
      Math.abs(body.difference) > MAX_VALUE ||
      typeof body.resultPercent !== "number" ||
      !Number.isFinite(body.resultPercent) ||
      Math.abs(body.resultPercent) > 1_000_000
    ) {
      throw new Error("invalid trade");
    }
    const trade: CommunityTrade = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      gave: body.gave,
      received: body.received,
      difference: body.difference,
      resultPercent: body.resultPercent,
    };
    this.trades = [trade, ...this.trades].slice(0, MAX_TRADES);
    this.persist();
    return trade;
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ trades: this.trades })}\n`, "utf8");
    renameSync(temp, this.file);
  }
}
