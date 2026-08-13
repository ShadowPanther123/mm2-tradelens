import type { CommunityTrade, TradeRecord } from "@/types";

const configured = import.meta.env.VITE_COMMUNITY_API_URL?.trim();
const baseUrl = configured || (import.meta.env.DEV ? "http://localhost:8787" : "");

export const communityFeedConfigured = baseUrl.length > 0;

export async function listCommunityTrades(): Promise<CommunityTrade[]> {
  if (!baseUrl) return [];
  const response = await fetch(`${baseUrl}/v1/community/trades`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`community feed returned ${response.status}`);
  const body = (await response.json()) as { trades?: CommunityTrade[] };
  return Array.isArray(body.trades) ? body.trades : [];
}

export async function shareCommunityTrade(record: TradeRecord): Promise<void> {
  if (!baseUrl) throw new Error("Community feed is not configured for this build");
  const response = await fetch(`${baseUrl}/v1/community/trades`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gave: record.gave,
      received: record.received,
      difference: record.calculation?.difference ?? 0,
      resultPercent: record.resultPercent,
    }),
  });
  if (!response.ok) throw new Error(`community share returned ${response.status}`);
}
