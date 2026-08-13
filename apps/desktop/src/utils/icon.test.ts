import { describe, it, expect } from "vitest";
import { itemIconSrc, isUsableLocalImage, PLACEHOLDER_ICON } from "./icon";

describe("itemIconSrc", () => {
  it("returns the placeholder for an external (hotlink) image", () => {
    expect(itemIconSrc({ id: "seer", image: "https://cdn/x.png" })).toBe(
      PLACEHOLDER_ICON,
    );
  });

  it("returns the placeholder when there is no bundled image", () => {
    expect(itemIconSrc({ id: "ghost" })).toBe(PLACEHOLDER_ICON);
  });

  it("passes data URIs through untouched", () => {
    const uri = "data:image/png;base64,AAAA";
    expect(itemIconSrc({ id: "x", image: uri })).toBe(uri);
  });

  it("resolves the same source regardless of caller (size-independent)", () => {
    const item = { id: "seer", image: "https://cdn/x.png" };
    const a = itemIconSrc(item);
    const b = itemIconSrc(item);
    expect(a).toBe(b);
  });
});

describe("isUsableLocalImage", () => {
  it("accepts local and in-memory references", () => {
    expect(isUsableLocalImage("icons/items/seer.png")).toBe(true);
    expect(isUsableLocalImage("data:image/png;base64,AAAA")).toBe(true);
  });

  it("rejects hotlinks and empty values", () => {
    expect(isUsableLocalImage("https://cdn/x.png")).toBe(false);
    expect(isUsableLocalImage(undefined)).toBe(false);
    expect(isUsableLocalImage("")).toBe(false);
  });
});
