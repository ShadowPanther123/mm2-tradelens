import { useState } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { DEFAULT_SNAPSHOT_URL, isValuesServiceConfigured } from "@/services/updates";
import type { ItemCategory } from "@/types";
import { feedIconSrc, isUsableLocalImage, localImageSrc, PLACEHOLDER_ICON } from "@/utils/icon";

const ICONS: Record<ItemCategory, string> = {
  knife: "🔪",
  gun: "🔫",
  pet: "🐾",
  bundle: "🎁",
  other: "◆",
};

/**
 * Prefer bundled artwork. New icons can load from the configured values feed
 * when the current snapshot references an image the app did not ship with.
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
  const offlineMode = useDataStore((state) => state.settings.offlineMode);
  const dims =
    size === "lg"
      ? "h-14 w-14 text-2xl"
      : size === "sm"
        ? "h-8 w-8 text-base"
        : "h-10 w-10 text-lg";

  const src = isUsableLocalImage(image) ? localImageSrc(image) : undefined;
  const remoteSrc = !offlineMode && isValuesServiceConfigured && image
    ? feedIconSrc(image, DEFAULT_SNAPSHOT_URL)
    : undefined;

  return (
    <div
      className={`grid ${dims} shrink-0 place-items-center overflow-hidden rounded-xl bg-base-500/60 border border-white/5`}
    >
      {src ? (
        <IconImage
          key={`${src}|${remoteSrc ?? ""}`}
          src={src}
          remoteSrc={remoteSrc}
          alt={alt}
          category={category}
        />
      ) : (
        <span>{ICONS[category]}</span>
      )}
    </div>
  );
}

function IconImage({
  src,
  remoteSrc,
  alt,
  category,
}: {
  src: string;
  remoteSrc?: string;
  alt?: string;
  category: ItemCategory;
}) {
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(src);
  if (!currentSrc) return <span>{ICONS[category]}</span>;

  return (
    <img
      src={currentSrc}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-contain"
      onError={() => {
        if (currentSrc === PLACEHOLDER_ICON) setCurrentSrc(undefined);
        else setCurrentSrc(currentSrc === src && remoteSrc ? remoteSrc : PLACEHOLDER_ICON);
      }}
    />
  );
}
