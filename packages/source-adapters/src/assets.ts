import type { Item } from "@tradelens/item-schema";
import { slugify } from "./index.js";

/**
 * Item icon and asset conventions, shared by the desktop app, the audit
 * tooling and the asset-validation scripts. Everything here is a pure function
 * so it runs unchanged in the browser and in Node — no filesystem access.
 *
 * Design rules encoded here:
 *  - Icons are addressed by a *canonical* filename derived from the item id.
 *  - Only a small allow-list of formats is permitted.
 *  - External URLs are never used directly (no hotlinking): an item either
 *    resolves to a bundled local asset or to the shared placeholder.
 */

/** Directory (relative to the app's public root) holding per-item icons. */
export const ITEM_ICON_DIR = "icons/items";

/** Shared placeholder shown when an item has no usable icon. */
export const MISSING_ICON_PLACEHOLDER = "icons/placeholder.svg";

/** Image formats an item icon may use. */
export const ALLOWED_ICON_FORMATS = ["png", "webp", "jpg", "jpeg", "svg"] as const;
export type IconFormat = (typeof ALLOWED_ICON_FORMATS)[number];

/**
 * Display sizes (px) the icon is rendered at, mirrored by the desktop
 * `ItemIcon` size presets (sm/md/lg). Raster icons should be authored at the
 * largest size (or 2×) so they stay crisp when scaled down.
 */
export const ICON_DISPLAY_SIZES = [32, 64, 128] as const;

/** Default constraints applied to a bundled item icon. */
export interface IconConstraints {
  /** Largest permitted file size in bytes. */
  maxBytes: number;
  /** Permitted formats. */
  formats: readonly IconFormat[];
  /** Smallest permitted edge, in pixels. */
  minEdge: number;
  /** Largest permitted edge, in pixels. */
  maxEdge: number;
  /** Require the image to be (near-)square. */
  requireSquare: boolean;
  /** Allowed |width-height|/max ratio when requireSquare is set (0–1). */
  squareTolerance: number;
}

export const DEFAULT_ICON_CONSTRAINTS: IconConstraints = {
  maxBytes: 64 * 1024,
  formats: ALLOWED_ICON_FORMATS,
  minEdge: 16,
  maxEdge: 512,
  requireSquare: true,
  squareTolerance: 0.05,
};

/** The file extension (lower-case, no dot) of a path, or "". */
export function extensionOf(path: string): string {
  const clean = path.split(/[?#]/)[0]!;
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
}

/** True when a reference points at an external resource we must not hotlink. */
export function isHotlink(ref: string): boolean {
  return /^(https?:)?\/\//i.test(ref.trim());
}

/** True when a reference is a local (bundled or in-memory) asset we may use. */
export function isLocalAsset(ref: string): boolean {
  const r = ref.trim();
  if (r === "") return false;
  if (isHotlink(r)) return false;
  // data:/blob: are user-supplied in-memory images (e.g. OCR uploads); allow.
  return true;
}

/** Whether an extension is one of the permitted icon formats. */
export function isAllowedIconFormat(ext: string): ext is IconFormat {
  return (ALLOWED_ICON_FORMATS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * Canonical icon filename for an item id, e.g. `icepiercer.png`. The id must
 * already be a slug; anything else is normalised so the convention holds.
 */
export function iconFilename(id: string, format: IconFormat = "png"): string {
  const slug = /^[a-z0-9-]+$/.test(id) ? id : slugify(id);
  return `${slug}.${format}`;
}

/** Canonical, public-root-relative path for an item's icon. */
export function iconPath(id: string, format: IconFormat = "png"): string {
  return `${ITEM_ICON_DIR}/${iconFilename(id, format)}`;
}

/**
 * Resolve the icon source for an item without ever hotlinking.
 *
 * Resolution order:
 *  1. The item's own `image`, but only if it is a permitted *local* asset and,
 *     when `availablePaths` is supplied, actually exists in the bundle.
 *  2. The canonical `icons/items/<id>.<fmt>` path if it exists in the bundle.
 *  3. The shared placeholder.
 *
 * When `availablePaths` is omitted the check is convention-only (used where the
 * bundle listing is not known, e.g. the browser) and the `<img>` `onError`
 * fallback handles a genuinely missing file.
 */
export function resolveItemIcon(
  item: Pick<Item, "id" | "image">,
  availablePaths?: ReadonlySet<string>,
): string {
  const has = (p: string) => (availablePaths ? availablePaths.has(p) : true);

  if (item.image && isLocalAsset(item.image)) {
    const ext = extensionOf(item.image);
    if ((isAllowedIconFormat(ext) || item.image.startsWith("data:")) && has(item.image)) {
      return item.image;
    }
  }

  for (const format of ALLOWED_ICON_FORMATS) {
    const candidate = iconPath(item.id, format);
    if (availablePaths && has(candidate)) return candidate;
  }

  return MISSING_ICON_PLACEHOLDER;
}

/** A single problem found while validating an icon asset. */
export interface IconIssue {
  id: string;
  code:
    | "hotlink"
    | "unknown-format"
    | "too-large"
    | "too-small"
    | "not-square"
    | "oversized-bytes"
    | "empty-file"
    | "unreadable";
  detail: string;
}

/** Metadata about an on-disk icon file, gathered by the validation script. */
export interface IconFileMeta {
  id: string;
  /** Path or reference recorded on the item. */
  path: string;
  /** Decoded pixel width, if known. */
  width?: number;
  /** Decoded pixel height, if known. */
  height?: number;
  /** File size in bytes, if known. */
  bytes?: number;
  /** Whether the file could be opened/decoded at all. */
  readable?: boolean;
  /** Content hash, used for duplicate detection. */
  hash?: string;
}

/** Validate one icon's reference and metadata against the constraints. */
export function validateIcon(
  meta: IconFileMeta,
  constraints: IconConstraints = DEFAULT_ICON_CONSTRAINTS,
): IconIssue[] {
  const issues: IconIssue[] = [];
  const push = (code: IconIssue["code"], detail: string) =>
    issues.push({ id: meta.id, code, detail });

  if (isHotlink(meta.path)) {
    push("hotlink", meta.path);
    return issues; // A hotlink can't be validated locally; stop here.
  }

  const ext = extensionOf(meta.path);
  if (!isAllowedIconFormat(ext)) {
    push("unknown-format", ext || "(none)");
  }

  if (meta.readable === false) push("unreadable", meta.path);
  if (meta.bytes !== undefined) {
    if (meta.bytes === 0) push("empty-file", meta.path);
    else if (meta.bytes > constraints.maxBytes)
      push("oversized-bytes", `${meta.bytes} > ${constraints.maxBytes}`);
  }

  if (meta.width !== undefined && meta.height !== undefined) {
    const min = Math.min(meta.width, meta.height);
    const max = Math.max(meta.width, meta.height);
    if (min < constraints.minEdge) push("too-small", `${meta.width}x${meta.height}`);
    if (max > constraints.maxEdge) push("too-large", `${meta.width}x${meta.height}`);
    if (constraints.requireSquare && max > 0) {
      const skew = (max - min) / max;
      if (skew > constraints.squareTolerance) push("not-square", `${meta.width}x${meta.height}`);
    }
  }

  return issues;
}

/** A group of item ids that share an identical icon (by content hash). */
export interface DuplicateIconGroup {
  hash: string;
  ids: string[];
}

/** Group icons that share a content hash so duplicates can be de-duplicated. */
export function findDuplicateIcons(metas: readonly IconFileMeta[]): DuplicateIconGroup[] {
  const byHash = new Map<string, string[]>();
  for (const meta of metas) {
    if (!meta.hash) continue;
    const ids = byHash.get(meta.hash) ?? [];
    ids.push(meta.id);
    byHash.set(meta.hash, ids);
  }
  const groups: DuplicateIconGroup[] = [];
  for (const [hash, ids] of byHash) {
    if (ids.length > 1) groups.push({ hash, ids: [...ids].sort() });
  }
  return groups.sort((a, b) => (a.hash < b.hash ? -1 : 1));
}

/** Item ids whose icon is broken (unreadable or empty). */
export function findBrokenIcons(metas: readonly IconFileMeta[]): string[] {
  return metas
    .filter((m) => m.readable === false || m.bytes === 0)
    .map((m) => m.id)
    .sort();
}
