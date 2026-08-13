import { safeParseSnapshot } from "@tradelens/item-schema";
import type { SourceId, ValueSnapshot } from "@/types";

interface BundledHistory {
  schemaVersion: number;
  revision: number;
  generatedAt: string;
  items: Record<string, Partial<Record<SourceId, Array<{ value: number; at: string }>>>>;
}

let cataloguePromise: Promise<ValueSnapshot> | null = null;
let historyPromise: Promise<BundledHistory> | null = null;

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Bundled data request failed (${response.status}): ${path}`);
  return response.json();
}

export function loadBundledCatalogue(): Promise<ValueSnapshot> {
  cataloguePromise ??= readJson("/data/catalogue.json").then((raw) => {
    const parsed = safeParseSnapshot(raw);
    if (!parsed.success) throw new Error("Bundled catalogue failed schema validation");
    return parsed.data as ValueSnapshot;
  });
  return cataloguePromise;
}

function loadHistoryPayload(): Promise<BundledHistory> {
  historyPromise ??= readJson("/data/history.json").then((raw) => {
    if (!raw || typeof raw !== "object" || !("items" in raw) || !("revision" in raw)) {
      throw new Error("Bundled history has an invalid header");
    }
    return raw as BundledHistory;
  });
  return historyPromise;
}

export async function mergeBundledHistory(snapshot: ValueSnapshot): Promise<ValueSnapshot> {
  const payload = await loadHistoryPayload();
  if (payload.revision !== snapshot.revision || payload.generatedAt !== snapshot.generatedAt) {
    return snapshot;
  }
  const items = snapshot.items.map((item) => {
    const histories = payload.items[item.id];
    if (!histories) return item;
    const values = { ...item.values };
    for (const [source, history] of Object.entries(histories)) {
      const reading = values[source as SourceId];
      if (reading && Array.isArray(history)) values[source as SourceId] = { ...reading, history };
    }
    return { ...item, values };
  });
  return { ...snapshot, items };
}

export async function bundledHistoryPoints(snapshot: ValueSnapshot): Promise<
  Array<{ itemId: string; source: SourceId; value: number; recordedAt: string; revision: number }>
> {
  const payload = await loadHistoryPayload();
  if (payload.revision !== snapshot.revision || payload.generatedAt !== snapshot.generatedAt) return [];
  const points = [];
  for (const [itemId, sources] of Object.entries(payload.items)) {
    for (const [source, history] of Object.entries(sources)) {
      if (!Array.isArray(history)) continue;
      for (const [index, point] of history.entries()) {
        points.push({
          itemId,
          source: source as SourceId,
          value: point.value,
          recordedAt: point.at,
          revision: Math.max(0, payload.revision - history.length + index + 1),
        });
      }
    }
  }
  return points;
}
