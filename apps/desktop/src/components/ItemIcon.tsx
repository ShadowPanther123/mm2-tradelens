import { useState } from "react";
import type { ItemCategory } from "@/types";
import { isUsableLocalImage, localImageSrc, PLACEHOLDER_ICON } from "@/utils/icon";

const ICONS: Record<ItemCategory, string> = {
  knife: "🔪",
  gun: "🔫",
  pet: "🐾",
  bundle: "🎁",
  other: "◆",
};

/**
 * Category icon in a rounded tile. When an item has a *local* image it is
 * lazy-loaded and shown; external (hotlink) references are ignored. If the image
 * is missing or fails to load, the shared placeholder is tried, and finally the
 * emoji category glyph, so a row never renders a broken image.
 */
export function ItemIcon({
  category,
  image,
  alt,
  size = "md",
}: {
  category: ItemCategory;
  image?: string;
  alt?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const dims =
    size === "lg" ? "h-14 w-14 text-2xl" : size === "sm" ? "h-8 w-8 text-base" : "h-10 w-10 text-lg";

  // Never hotlink: only bundled/local or in-memory images are shown. Bundled
  // paths are made root-relative so they resolve on every route.
  const src = isUsableLocalImage(image) ? localImageSrc(image) : undefined;
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={`grid ${dims} shrink-0 place-items-center overflow-hidden rounded-xl bg-base-500/60 border border-white/5`}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
          onError={(e) => {
            // Try the placeholder once, then fall back to the emoji glyph.
            const img = e.currentTarget;
            if (img.src.endsWith(PLACEHOLDER_ICON)) {
              setFailed(true);
            } else {
              img.src = PLACEHOLDER_ICON;
            }
          }}
        />
      ) : (
        <span>{ICONS[category]}</span>
      )}
    </div>
  );
}
