import { cn } from "@/utils/cn";

/**
 * Crisp inline SVG icon set (24×24, currentColor stroke) used for navigation
 * and window chrome. Replaces the earlier Unicode glyphs, which rendered
 * inconsistently across fonts. Icons are decorative by default; give the
 * element an aria-label where the icon carries meaning on its own.
 */
export type IconName =
  | "dashboard"
  | "search"
  | "calculator"
  | "scan"
  | "trends"
  | "favorites"
  | "portfolio"
  | "community"
  | "analytics"
  | "history"
  | "settings"
  | "minimize"
  | "maximize"
  | "close"
  | "logo";

interface IconProps {
  name: IconName;
  className?: string;
  /** Optional accessible label. When omitted the icon is aria-hidden. */
  title?: string;
}

// Each entry is the inner markup of a 0 0 24 24 viewBox, drawn with
// stroke="currentColor". Kept intentionally simple and consistent in weight.
const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  calculator: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h16" />
    </>
  ),
  trends: (
    <>
      <path d="m4 15 5-5 4 4 7-8" />
      <path d="M16 6h4v4" />
    </>
  ),
  favorites: (
    <path d="m12 4 2.35 4.76 5.25.76-3.8 3.7.9 5.23L12 16.9l-4.7 2.46.9-5.23-3.8-3.7 5.25-.76z" />
  ),
  portfolio: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </>
  ),
  community: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.3A5.5 5.5 0 0 1 20.5 19" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 4v16h16" />
      <rect x="7" y="12" width="3" height="5" rx="0.6" />
      <rect x="12" y="9" width="3" height="8" rx="0.6" />
      <rect x="17" y="6" width="3" height="11" rx="0.6" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M5 3v3.5h3.5" />
      <path d="M12 8v4l2.5 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M3 12h2.5M18.5 12H21M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  minimize: <path d="M5 12h14" />,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  logo: (
    <>
      <path d="M12 3 4 7v6c0 4.4 3.4 7.3 8 8.5 4.6-1.2 8-4.1 8-8.5V7z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

export function Icon({ name, className, title }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-5 w-5 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
