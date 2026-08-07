import type { TradeResult, TradeVerdict } from "@tradelens/trade-engine";
import { verdictLabel } from "@tradelens/trade-engine";
import { formatPercent, formatValue } from "@/utils/format";
import { cn } from "@/utils/cn";

const VERDICT_STYLES: Record<TradeVerdict, string> = {
  "big-win": "from-win/30 to-win/5 text-win border-win/40",
  win: "from-win/20 to-win/5 text-win border-win/30",
  fair: "from-fair/20 to-fair/5 text-fair border-fair/30",
  loss: "from-loss/20 to-loss/5 text-loss border-loss/30",
  "big-loss": "from-loss/30 to-loss/5 text-loss border-loss/40",
  unknown: "from-white/10 to-white/5 text-slate-300 border-white/10",
};

/** Headline verdict for the current trade, framed as gentle guidance. */
export function VerdictCard({ result }: { result: TradeResult }) {
  const verdict = result.adjustedVerdict;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-gradient-to-br p-5 backdrop-blur-xl",
        VERDICT_STYLES[verdict],
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold">{verdictLabel(verdict)}</span>
        <span className="text-sm font-medium tabular-nums">
          {result.difference >= 0 ? "+" : ""}
          {formatValue(result.difference)}
        </span>
      </div>

      <div className="mt-1 text-sm opacity-80">
        {result.your.total > 0 && (
          <>Difference {formatPercent(result.differencePercent)} · </>
        )}
        confidence {result.confidence}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-200/90">
        {result.explanation}
      </p>

      {result.warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex gap-2 text-xs text-slate-300/80">
              <span className="text-warn">⚠</span>
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
