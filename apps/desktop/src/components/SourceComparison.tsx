import type { Item, SourceId } from "@/types";
import { formatValue, formatRelative } from "@/utils/format";

const SOURCE_LABELS: Record<SourceId, string> = {
  supreme: "Supreme Values",
  mm2values: "MM2Values",
  community: "Community",
};

type Reading = { value: number; updatedAt?: string };

/**
 * Side-by-side per-source readings. Disagreement between sources is always
 * surfaced — never averaged away or hidden.
 */
export function SourceComparison({
  item,
  thresholdPercent = 5,
}: {
  item: Item;
  thresholdPercent?: number;
}) {
  const entries = Object.entries(item.values) as [SourceId, Reading][];

  // Difference is only meaningful when two sources both report a value.
  const priced = entries.filter(([, v]) => typeof v.value === "number" && v.value > 0);
  const [a, b] = priced.length === 2 ? priced : [];
  const difference = a && b ? Math.abs(a[1].value - b[1].value) : 0;
  const base = a && b ? Math.min(a[1].value, b[1].value) : 0;
  const differencePercent = base > 0 ? (difference / base) * 100 : 0;
  const disagrees = differencePercent > thresholdPercent;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Source comparison</h3>
      </div>

      <div className={`grid gap-3 ${entries.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {entries.map(([source, v]) => (
          <div key={source} className="glass-soft rounded-xl p-3 text-center">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              {SOURCE_LABELS[source]}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {formatValue(v.value)}
            </div>
            {v.updatedAt && (
              <div className="mt-1 text-[11px] text-slate-500">
                updated {formatRelative(v.updatedAt)}
              </div>
            )}
          </div>
        ))}
      </div>

      {a && b && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Difference</span>
            <span className="tabular-nums">
              {formatValue(difference)} ({differencePercent.toFixed(1)}%)
            </span>
          </div>
          {disagrees && (
            <div className="rounded-lg bg-warn/15 px-3 py-2 text-sm text-warn">
              Sources disagree significantly.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
