import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";

interface VirtualListProps<T> {
  items: T[];
  /** Fixed row height in pixels (including vertical gap). */
  itemHeight: number;
  /** Viewport height in pixels. */
  height: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  /** Extra rows rendered above/below the viewport to smooth fast scrolling. */
  overscan?: number;
  className?: string;
}

/**
 * Minimal windowed list: only the rows visible in the viewport (plus a small
 * overscan) are mounted, so lists of thousands of items stay responsive. Rows
 * are fixed-height and absolutely positioned inside a spacer sized to the full
 * list height. Dependency-free to avoid pulling in a virtualisation library.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  height,
  renderItem,
  getKey,
  overscan = 6,
  className,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const total = items.length;
  const totalHeight = total * itemHeight;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  const slice = items.slice(start, end);

  return (
    <div
      ref={ref}
      className={cn("overflow-y-auto", className)}
      style={{ height }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <div
              key={getKey(item, index)}
              style={{
                position: "absolute",
                top: index * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
