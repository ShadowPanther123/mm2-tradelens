import {
  isLocalAsset,
  MISSING_ICON_PLACEHOLDER,
  resolveItemIcon,
} from "@tradelens/source-adapters";

/**
 * Public-root-relative path of the shared missing-icon placeholder.
 * (Vite serves `apps/desktop/public` at the web root, so this resolves to
 * `/icons/placeholder.svg` at runtime.)
 */
export const PLACEHOLDER_ICON = `/${MISSING_ICON_PLACEHOLDER}`;

/**
 * Resolve the `<img src>` for an item icon without ever hotlinking an external
 * URL. External references are dropped in favour of the placeholder; bundled
 * paths are served from the app root; data/blob URIs are passed through.
 */
export function itemIconSrc(item: { id: string; image?: string }): string {
  const resolved = resolveItemIcon(item);
  if (resolved === MISSING_ICON_PLACEHOLDER) return PLACEHOLDER_ICON;
  if (resolved.startsWith("data:") || resolved.startsWith("blob:")) return resolved;
  return `/${resolved}`;
}

/** True when a raw image reference is safe to use directly (not a hotlink). */
export function isUsableLocalImage(ref: string | undefined): ref is string {
  return typeof ref === "string" && isLocalAsset(ref);
}

/**
 * Normalise a bundled/in-memory image reference to a value usable directly as
 * an `<img src>`. Bundled paths (e.g. `icons/items/batwing.png`) are made
 * root-relative so they resolve the same on every route and under Tauri's
 * custom protocol, where the document base URL is not the web root. data:/blob:
 * URIs and already-absolute paths are passed through unchanged.
 */
export function localImageSrc(ref: string): string {
  if (ref.startsWith("data:") || ref.startsWith("blob:") || ref.startsWith("/"))
    return ref;
  return `/${ref}`;
}
