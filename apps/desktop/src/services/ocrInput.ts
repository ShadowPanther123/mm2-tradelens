/**
 * Pure guards for user-supplied screenshots. Validating format and size before
 * any decoding keeps the OCR path safe against oversized or unsupported files
 * and gives the caller a clear, friendly reason to show. DOM-free so it can be
 * unit-tested in Node.
 */

/** Largest screenshot we will attempt to read, in bytes. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Longest edge (in pixels) we feed to the recognizer. Larger images are scaled
 * down first: past this size OCR gets slower and less accurate, not better.
 */
export const MAX_IMAGE_DIMENSION = 4096;

/** Image formats a browser canvas can reliably decode for OCR. */
export const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
  "image/gif",
] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export interface ImageFileInfo {
  /** MIME type, e.g. "image/png". */
  type: string;
  /** Size in bytes. */
  size: number;
  /** Optional file name, used only for a fallback extension check. */
  name?: string;
}

export type ImageValidation = { ok: true } | { ok: false; reason: string };

const EXTENSION_TYPES: Record<string, SupportedImageType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
  gif: "image/gif",
};

/** True when the MIME type (or, failing that, the file extension) is supported. */
export function isSupportedImage(info: ImageFileInfo): boolean {
  if (SUPPORTED_IMAGE_TYPES.includes(info.type as SupportedImageType)) return true;
  // Some drops/pastes arrive without a usable MIME type; fall back to extension.
  if (!info.type || info.type === "application/octet-stream") {
    const ext = info.name?.split(".").pop()?.toLowerCase() ?? "";
    return ext in EXTENSION_TYPES;
  }
  return false;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(0)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Validate a screenshot before any decoding or OCR work begins. */
export function validateImageFile(
  info: ImageFileInfo,
  maxBytes = MAX_FILE_BYTES,
): ImageValidation {
  if (info.size <= 0) {
    return { ok: false, reason: "That file looks empty." };
  }
  if (info.size > maxBytes) {
    return {
      ok: false,
      reason: `That image is too large (max ${formatBytes(maxBytes)}). Try a smaller crop.`,
    };
  }
  if (!isSupportedImage(info)) {
    return {
      ok: false,
      reason: "Unsupported image format. Use PNG, JPEG, WebP, BMP or GIF.",
    };
  }
  return { ok: true };
}

/**
 * Scale a width/height so its longest edge fits within `max`, never upscaling.
 * Returns the target size and the scale factor applied.
 */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_IMAGE_DIMENSION,
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height, scale: 1 };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}
