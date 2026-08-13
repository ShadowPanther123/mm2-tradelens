import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValueSnapshot } from "@/types";
import { bundledHistoryPoints } from "./bundledData";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("bundledHistoryPoints", () => {
  it("maps bundled observations to valid revisions ending at the snapshot revision", async () => {
    const snapshot = {
      schemaVersion: 1,
      revision: 22,
      generatedAt: "2026-08-12T09:41:47.323Z",
      items: [],
    } as unknown as ValueSnapshot;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          revision: snapshot.revision,
          generatedAt: snapshot.generatedAt,
          items: {
            harvester: {
              mm2values: [
                { value: 240, at: "2026-08-06T00:00:00.000Z" },
                { value: 245, at: "2026-08-10T00:00:00.000Z" },
              ],
            },
          },
        }),
      })),
    );

    const points = await bundledHistoryPoints(snapshot);

    expect(points.map((point) => point.revision)).toEqual([21, 22]);
    expect(points.every((point) => point.revision >= 0)).toBe(true);
  });
});
