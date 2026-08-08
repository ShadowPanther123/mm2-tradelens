/** Presentation helpers shared across the UI. */

export function formatValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * Format an absolute value change with an explicit sign, e.g. `+5`, `+10`,
 * `-10`. Zero is rendered without a sign. Used by the value-change alerts so a
 * move reads at a glance.
 */
export function formatSignedValue(change: number): string {
  const rounded = Math.round(change);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US")}`;
}

export function formatPercent(pct: number, withSign = true): string {
  const rounded = pct.toFixed(1);
  if (!withSign) return `${rounded}%`;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const diffH = (Date.now() - t) / (1000 * 60 * 60);
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

export function trendArrow(pct: number): "▲" | "▼" | "→" {
  if (pct > 0.05) return "▲";
  if (pct < -0.05) return "▼";
  return "→";
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
