import { useId } from "react";

interface SparklineProps {
  /** Ordered data points, oldest first. */
  points: number[];
  width?: number;
  height?: number;
  /** Colour hint; defaults to a calm neutral that shifts with direction. */
  tone?: "auto" | "up" | "down" | "neutral";
  className?: string;
}

const TONE_COLORS: Record<"up" | "down" | "neutral", string> = {
  up: "#7bd3a0",
  down: "#f2a5a5",
  neutral: "#8aa0c6",
};

/**
 * A tiny, dependency-free SVG sparkline. Draws a smooth polyline with a soft
 * gradient fill. Handles 0, 1 or many points gracefully.
 */
export function Sparkline({
  points,
  width = 96,
  height = 28,
  tone = "auto",
  className,
}: SparklineProps) {
  const gradientId = useId();

  if (points.length === 0) {
    return <div style={{ width, height }} className={className} />;
  }

  const resolvedTone: "up" | "down" | "neutral" =
    tone === "auto"
      ? points[points.length - 1] > points[0]
        ? "up"
        : points[points.length - 1] < points[0]
          ? "down"
          : "neutral"
      : tone;
  const color = TONE_COLORS[resolvedTone];

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const coords = points.map((p, i) => {
    const x =
      points.length === 1 ? pad + innerW / 2 : pad + (i / (points.length - 1)) * innerW;
    const y = pad + innerH - ((p - min) / span) * innerH;
    return [x, y] as const;
  });

  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.length > 0 && (
        <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={2} fill={color} />
      )}
    </svg>
  );
}
