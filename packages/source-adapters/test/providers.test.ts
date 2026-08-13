import { describe, expect, it, vi } from "vitest";
import { createSupremeProvider } from "../src/providers.js";

describe("SupremeValues provider", () => {
  it("refuses to initialize without a permission basis", () => {
    expect(() =>
      createSupremeProvider(
        {
          baseUrl: "https://partner.example/supreme",
          authorizationReference: "agreement-2026-01",
        },
        undefined,
      ),
    ).toThrow(/permission basis/i);
  });

  it("refuses public pages and missing written-authorization references", () => {
    expect(() =>
      createSupremeProvider({ baseUrl: "https://partner.example/supreme" }, "partner-agreement"),
    ).toThrow(/authorization reference/i);
    expect(() =>
      createSupremeProvider(
        {
          baseUrl: "https://supremevalues.com",
          authorizationReference: "agreement-2026-01",
        },
        "partner-agreement",
      ),
    ).toThrow(/public SupremeValues pages/i);
  });

  it("normalizes an authorized partner feed", async () => {
    const provider = createSupremeProvider(
      {
        baseUrl: "https://partner.example/supreme/",
        token: "secret",
        authorizationReference: "agreement-2026-01",
      },
      "partner-agreement",
    );
    const fetchJson = vi.fn().mockResolvedValue({
      items: [
        {
          id: "seer-1",
          name: "Seer",
          type: "knife",
          rarity: "godly",
          value: 40,
          updated_at: "2026-08-12T00:00:00.000Z",
        },
      ],
    });
    const rows = await provider.fetchRows({
      fetchJson,
      now: () => "2026-08-12T01:00:00.000Z",
    });
    expect(fetchJson).toHaveBeenCalledWith(
      "https://partner.example/supreme/items",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret" }) }),
    );
    expect(rows[0]).toMatchObject({
      name: "Seer",
      category: "knife",
      rarity: "godly",
      value: 40,
      sourceItemId: "seer-1",
      extractionMethod: "partner-feed",
      verified: true,
    });
  });
});
