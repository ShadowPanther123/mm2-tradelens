import { describe, it, expect } from "vitest";
import type { Item, SourceId, SourceValue } from "@tradelens/item-schema";
import {
  ALLOWED_ICON_FORMATS,
  DEFAULT_ICON_CONSTRAINTS,
  ICON_DISPLAY_SIZES,
  ITEM_ICON_DIR,
  MISSING_ICON_PLACEHOLDER,
  extensionOf,
  iconFilename,
  iconPath,
  isAllowedIconFormat,
  isHotlink,
  isLocalAsset,
  resolveItemIcon,
  validateIcon,
  findDuplicateIcons,
  findBrokenIcons,
  type IconFileMeta,
} from "../src/assets.js";
import {
  ASSET_LICENSES,
  licenseFor,
  findUnlicensedAssets,
  type AssetLicense,
} from "../src/licenses.js";

function item(overrides: Partial<Item> & Pick<Item, "id" | "displayName">): Item {
  return {
    aliases: [],
    category: "knife",
    rarity: "godly",
    chroma: false,
    verified: true,
    values: {} as Record<SourceId, SourceValue>,
    ...overrides,
  };
}

describe("icon filename convention", () => {
  it("derives a canonical filename from a slug id", () => {
    expect(iconFilename("icepiercer")).toBe("icepiercer.png");
    expect(iconFilename("icepiercer", "webp")).toBe("icepiercer.webp");
  });

  it("normalises a non-slug id back to the convention", () => {
    expect(iconFilename("Ice Piercer!")).toBe("ice-piercer.png");
  });

  it("builds the public-root-relative path", () => {
    expect(iconPath("seer")).toBe(`${ITEM_ICON_DIR}/seer.png`);
  });

  it("extracts a lower-case extension, ignoring query/hash", () => {
    expect(extensionOf("a/b/seer.PNG")).toBe("png");
    expect(extensionOf("seer.webp?v=2")).toBe("webp");
    expect(extensionOf("noext")).toBe("");
  });

  it("only permits the allow-listed formats", () => {
    for (const f of ALLOWED_ICON_FORMATS) expect(isAllowedIconFormat(f)).toBe(true);
    expect(isAllowedIconFormat("gif")).toBe(false);
    expect(isAllowedIconFormat("jpg")).toBe(false);
  });
});

describe("hotlink safety", () => {
  it("recognises external references", () => {
    expect(isHotlink("https://example.com/a.png")).toBe(true);
    expect(isHotlink("http://example.com/a.png")).toBe(true);
    expect(isHotlink("//cdn.example.com/a.png")).toBe(true);
  });

  it("treats bundled and in-memory refs as local", () => {
    expect(isLocalAsset("icons/items/seer.png")).toBe(true);
    expect(isLocalAsset("data:image/png;base64,AAAA")).toBe(true);
    expect(isLocalAsset("https://example.com/a.png")).toBe(false);
    expect(isLocalAsset("")).toBe(false);
  });
});

describe("resolveItemIcon", () => {
  it("never returns a hotlink, falling back to the placeholder", () => {
    const it0 = item({ id: "seer", displayName: "Seer", image: "https://cdn/x.png" });
    expect(resolveItemIcon(it0)).toBe(MISSING_ICON_PLACEHOLDER);
  });

  it("uses a bundled local image when it is present", () => {
    const it0 = item({ id: "seer", displayName: "Seer", image: "icons/items/seer.webp" });
    const available = new Set(["icons/items/seer.webp"]);
    expect(resolveItemIcon(it0, available)).toBe("icons/items/seer.webp");
  });

  it("falls back to the canonical path when the item has no image", () => {
    const it0 = item({ id: "seer", displayName: "Seer" });
    const available = new Set(["icons/items/seer.png"]);
    expect(resolveItemIcon(it0, available)).toBe("icons/items/seer.png");
  });

  it("uses the placeholder when nothing is available", () => {
    const it0 = item({ id: "ghost", displayName: "Ghost" });
    expect(resolveItemIcon(it0, new Set())).toBe(MISSING_ICON_PLACEHOLDER);
  });

  it("resolves consistently regardless of display size", () => {
    const it0 = item({ id: "seer", displayName: "Seer", image: "icons/items/seer.png" });
    const available = new Set(["icons/items/seer.png"]);
    for (const _size of ICON_DISPLAY_SIZES) {
      expect(resolveItemIcon(it0, available)).toBe("icons/items/seer.png");
    }
  });
});

describe("validateIcon", () => {
  const base: IconFileMeta = {
    id: "seer",
    path: "icons/items/seer.png",
    width: 128,
    height: 128,
    bytes: 4096,
    readable: true,
  };

  it("passes a well-formed icon", () => {
    expect(validateIcon(base)).toEqual([]);
  });

  it("rejects a hotlinked reference", () => {
    const issues = validateIcon({ ...base, path: "https://cdn/x.png" });
    expect(issues.map((i) => i.code)).toEqual(["hotlink"]);
  });

  it("rejects a disallowed format", () => {
    const issues = validateIcon({ ...base, path: "icons/items/seer.gif" });
    expect(issues.some((i) => i.code === "unknown-format")).toBe(true);
  });

  it("flags oversized bytes, oversized dimensions and non-square shapes", () => {
    const issues = validateIcon({
      ...base,
      bytes: DEFAULT_ICON_CONSTRAINTS.maxBytes + 1,
      width: 1024,
      height: 512,
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("oversized-bytes");
    expect(codes).toContain("too-large");
    expect(codes).toContain("not-square");
  });

  it("flags too-small and empty files", () => {
    expect(validateIcon({ ...base, width: 8, height: 8 }).some((i) => i.code === "too-small")).toBe(
      true,
    );
    expect(validateIcon({ ...base, bytes: 0 }).some((i) => i.code === "empty-file")).toBe(true);
  });
});

describe("duplicate and broken detection", () => {
  it("groups icons that share a content hash", () => {
    const metas: IconFileMeta[] = [
      { id: "a", path: "icons/items/a.png", hash: "h1" },
      { id: "b", path: "icons/items/b.png", hash: "h1" },
      { id: "c", path: "icons/items/c.png", hash: "h2" },
    ];
    const groups = findDuplicateIcons(metas);
    expect(groups).toEqual([{ hash: "h1", ids: ["a", "b"] }]);
  });

  it("lists unreadable or empty icons as broken", () => {
    const metas: IconFileMeta[] = [
      { id: "ok", path: "icons/items/ok.png", readable: true, bytes: 10 },
      { id: "empty", path: "icons/items/empty.png", bytes: 0 },
      { id: "bad", path: "icons/items/bad.png", readable: false },
    ];
    expect(findBrokenIcons(metas)).toEqual(["bad", "empty"]);
  });
});

describe("asset licensing", () => {
  it("ships a licence record for the placeholder", () => {
    const rec = licenseFor(MISSING_ICON_PLACEHOLDER);
    expect(rec?.permission).toBe("owned");
  });

  it("covers data URIs via a scheme prefix record", () => {
    const rec = licenseFor("data:image/png;base64,AAAA");
    expect(rec?.asset).toBe("data:");
  });

  it("reports item images with no licence record", () => {
    const items: Item[] = [
      item({ id: "seer", displayName: "Seer" }), // no image, skipped
      item({ id: "hot", displayName: "Hot", image: "https://cdn/x.png" }),
      item({ id: "loc", displayName: "Loc", image: "icons/items/loc.png" }),
    ];
    const unlicensed = findUnlicensedAssets(items);
    expect(unlicensed.map((u) => u.itemId)).toEqual(["hot", "loc"]);
    expect(unlicensed.find((u) => u.itemId === "hot")?.hotlink).toBe(true);
  });

  it("passes when a record covers the image", () => {
    const registry: AssetLicense[] = [
      ...ASSET_LICENSES,
      {
        asset: "icons/items/loc.png",
        source: "TradeLens",
        license: "CC0-1.0",
        permission: "owned",
      },
    ];
    const items: Item[] = [item({ id: "loc", displayName: "Loc", image: "icons/items/loc.png" })];
    expect(findUnlicensedAssets(items, registry)).toEqual([]);
  });
});
