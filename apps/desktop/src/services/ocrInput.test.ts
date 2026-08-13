import { describe, expect, it } from "vitest";
import {
  fitWithin,
  isSupportedImage,
  MAX_FILE_BYTES,
  MAX_IMAGE_DIMENSION,
  validateImageFile,
} from "./ocrInput";

describe("isSupportedImage", () => {
  it("accepts known image MIME types", () => {
    expect(isSupportedImage({ type: "image/png", size: 10 })).toBe(true);
    expect(isSupportedImage({ type: "image/jpeg", size: 10 })).toBe(true);
    expect(isSupportedImage({ type: "image/webp", size: 10 })).toBe(true);
  });

  it("rejects non-image types", () => {
    expect(isSupportedImage({ type: "application/pdf", size: 10 })).toBe(false);
    expect(isSupportedImage({ type: "text/plain", size: 10 })).toBe(false);
  });

  it("falls back to the file extension when the type is missing", () => {
    expect(isSupportedImage({ type: "", size: 10, name: "shot.PNG" })).toBe(true);
    expect(
      isSupportedImage({ type: "application/octet-stream", size: 10, name: "a.webp" }),
    ).toBe(true);
    expect(isSupportedImage({ type: "", size: 10, name: "notes.txt" })).toBe(false);
  });
});

describe("validateImageFile", () => {
  it("accepts a normal screenshot", () => {
    expect(validateImageFile({ type: "image/png", size: 500_000 })).toEqual({
      ok: true,
    });
  });

  it("rejects empty files", () => {
    const result = validateImageFile({ type: "image/png", size: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects oversized files", () => {
    const result = validateImageFile({ type: "image/png", size: MAX_FILE_BYTES + 1 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/too large/i);
  });

  it("rejects unsupported formats safely", () => {
    const result = validateImageFile({ type: "application/zip", size: 10 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/unsupported/i);
  });
});

describe("fitWithin", () => {
  it("leaves images within bounds untouched", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it("scales oversized images down to the longest-edge cap", () => {
    const fit = fitWithin(
      MAX_IMAGE_DIMENSION * 2,
      MAX_IMAGE_DIMENSION,
      MAX_IMAGE_DIMENSION,
    );
    expect(fit.width).toBe(MAX_IMAGE_DIMENSION);
    expect(fit.height).toBe(MAX_IMAGE_DIMENSION / 2);
    expect(fit.scale).toBeCloseTo(0.5);
  });

  it("never upscales", () => {
    expect(fitWithin(10, 10, 4096).scale).toBe(1);
  });
});
