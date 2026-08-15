import type { Item, SourceId } from "@/types";
import { readingConfidence, type Confidence } from "@tradelens/trade-engine";
import { capitalise, formatDate, formatValue } from "@/utils/format";

const SOURCE_LABELS: Record<SourceId, string> = {
  supreme: "Supreme Values",
  mm2values: "MM2Values",
};

/** Tailwind text colour per confidence level, calm rather than alarming. */
const CONFIDENCE_TONE: Record<Confidence, string> = {
  high: "text-win",
  medium: "text-warn",
  low: "text-slate-400",
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

      <div
        className={`grid gap-3 ${entries.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
      >
        {entries.map(([source, v]) => {
          const confidence = readingConfidence(v as Reading & { updatedAt: string });
          return (
            <div key={source} className="glass-soft rounded-xl p-3 text-center">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                {SOURCE_LABELS[source]}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatValue(v.value)}
              </div>
              <dl className="mt-2 flex flex-col gap-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Updated</dt>
                  <dd className="text-slate-400">
                    {v.updatedAt ? formatDate(v.updatedAt) : "unknown"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Confidence</dt>
                  <dd className={`font-medium ${CONFIDENCE_TONE[confidence]}`}>
                    {capitalise(confidence)}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
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
