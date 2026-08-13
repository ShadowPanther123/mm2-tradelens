import { describe, expect, it } from "vitest";
import { CommunityTradeStore } from "../src/community.js";

describe("community trade store", () => {
  it("accepts anonymous trade fields and assigns server metadata", () => {
    const store = new CommunityTradeStore();
    const trade = store.add({
      gave: [{ itemId: "harvester", quantity: 1 }],
      received: [{ itemId: "icebreaker", quantity: 1 }],
      difference: 15,
      resultPercent: 6,
      username: "must-not-be-stored",
    });
    expect(trade.id).toBeTruthy();
    expect(trade).not.toHaveProperty("username");
    expect(store.list()).toEqual([trade]);
  });

  it("rejects malformed trades", () => {
    const store = new CommunityTradeStore();
    expect(() => store.add({ gave: [], received: [] })).toThrow();
    expect(() =>
      store.add({
        gave: [{ itemId: "Bad!", quantity: 1 }],
        received: [{ itemId: "seer", quantity: 1 }],
        difference: 0,
        resultPercent: 0,
      }),
    ).toThrow();
  });
});
