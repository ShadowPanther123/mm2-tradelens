import type { Item } from "@/types";

/**
 * Marks items whose values are not from a confirmed trusted source (for example
 * placeholder or manually entered records). Shown so users never mistake an
 * unverified value for a confirmed one.
 */
export function UnverifiedBadge({ item, className }: { item: Item; className?: string }) {
  if (item.verified) return null;
  return (
    <span
      className={`chip bg-amber-500/15 text-amber-300 ${className ?? ""}`}
      title="This item's value is not from a confirmed trusted source. Treat it as a rough placeholder."
    >
      Unverified
    </span>
  );
}
