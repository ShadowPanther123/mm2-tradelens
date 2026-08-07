interface StatPillProps {
  label: string;
  value: string;
  accent?: "default" | "up" | "down";
}

const ACCENT: Record<NonNullable<StatPillProps["accent"]>, string> = {
  default: "text-slate-100",
  up: "text-win",
  down: "text-loss",
};

/** Compact label/value stat used across cards. */
export function StatPill({ label, value, accent = "default" }: StatPillProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-sm font-medium ${ACCENT[accent]}`}>{value}</span>
    </div>
  );
}
