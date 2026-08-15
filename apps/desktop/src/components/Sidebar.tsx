import { NavLink } from "react-router-dom";
import { cn } from "@/utils/cn";
import { useDataStore } from "@/hooks/useDataStore";
import { Icon, type IconName } from "./Icon";
import type { SourceMode } from "@/types";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/calculator", label: "Calculator", icon: "calculator" },
  { to: "/scan", label: "Scan", icon: "scan" },
  { to: "/trends", label: "Trends", icon: "trends" },
  { to: "/favorites", label: "Favorites", icon: "favorites" },
  { to: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { to: "/community", label: "Community", icon: "community" },
  { to: "/analytics", label: "Analytics", icon: "analytics" },
  { to: "/history", label: "History", icon: "history" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

const SOURCE_LABELS: Record<SourceMode, string> = {
  supreme: "Supreme Values",
  mm2values: "MM2Values",
  "compare-both": "Compare Both",
  consensus: "Combined estimate",
};

/** Always-visible readout of which source and data revision is in use. */
function SourceIndicator() {
  const mode = useDataStore((s) => s.settings.sourceMode);
  const revision = useDataStore((s) => s.snapshotMeta?.revision);
  const isSampleData = useDataStore((s) => s.isSampleData);
  return (
    <div className="px-2 pb-1 pt-3 text-[11px] leading-relaxed text-slate-500">
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-600">Source</span>
        <span className="truncate font-medium text-slate-400">
          {SOURCE_LABELS[mode]}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="text-slate-600">Data</span>
        <span className="truncate font-medium text-slate-400">
          {isSampleData ? "Sample data" : revision ? `rev ${revision}` : "—"}
        </span>
      </div>
    </div>
  );
}

/** Left navigation rail. */
export function Sidebar() {
  return (
    <nav className="flex w-14 shrink-0 flex-col gap-1 border-r border-white/5 bg-base-800/40 p-2 sm:w-52 sm:p-3">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          title={item.label}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center justify-center gap-3 rounded-xl px-2 py-2.5 text-sm font-medium transition-colors sm:justify-start sm:px-3",
              isActive
                ? "bg-accent/15 text-white shadow-glow"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent transition-opacity sm:block",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon
                name={item.icon}
                className={cn(
                  "h-5 w-5 transition-transform group-hover:scale-110",
                  isActive ? "text-accent-soft" : "text-slate-400",
                )}
              />
              <span className="sr-only sm:not-sr-only">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
      <div className="mt-auto hidden border-t border-white/5 sm:block">
        <SourceIndicator />
        <div className="px-2 pt-2 text-[10px] leading-relaxed text-slate-600">
          Independent fan project. Not affiliated with Roblox, Nikilis, MM2Values or
          Supreme Values.
        </div>
      </div>
    </nav>
  );
}
