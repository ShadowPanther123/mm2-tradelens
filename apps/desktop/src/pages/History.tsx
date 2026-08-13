import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDataStore } from "@/hooks/useDataStore";
import { useToast } from "@/contexts/ToastContext";
import { EmptyState } from "@/components";
import { formatPercent, formatDate, formatValue } from "@/utils/format";
import { sourceModeLabel } from "@/utils/sourceMode";
import { downloadTextFile } from "@/utils/download";
import {
  filterHistory,
  exportHistory,
  verdictForRecord,
  type OutcomeFilter,
} from "@/utils/history";
import type { Item, TradeRecord, TradeSlot } from "@/types";
import { verdictLabel } from "@tradelens/trade-engine";
import { useTradeStore } from "@/hooks/useTradeStore";
import { communityFeedConfigured, shareCommunityTrade } from "@/services/community";

function summarise(
  slots: TradeSlot[],
  itemById: (id: string) => { displayName: string } | undefined,
): string {
  if (slots.length === 0) return "nothing";
  return slots
    .map((s) => {
      const item = itemById(s.itemId);
      const name = item?.displayName ?? s.itemId;
      return s.quantity > 1 ? `${name} ×${s.quantity}` : name;
    })
    .join(", ");
}

export function History() {
  const history = useDataStore((s) => s.history);
  const itemById = useDataStore((s) => s.itemById);
  const removeHistory = useDataStore((s) => s.removeHistory);
  const loadTrade = useTradeStore((s) => s.load);
  const navigate = useNavigate();
  const { notify } = useToast();

  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [mode, setMode] = useState("all");

  const modes = useMemo(
    () => Array.from(new Set(history.map((r) => r.mode))).sort(),
    [history],
  );

  const filtered = useMemo(
    () =>
      filterHistory(
        history,
        { query, outcome, mode },
        (id) => itemById(id) as Item | undefined,
      ),
    [history, query, outcome, mode, itemById],
  );

  function handleExport() {
    downloadTextFile(`tradelens-history-${Date.now()}.json`, exportHistory(history));
    notify("Trade history exported", "success");
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Trade history</h1>
        </div>
        <EmptyState
          icon="⟲"
          title="No saved trades yet"
          hint="Completed calculations from the calculator will appear here automatically."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Trade history</h1>
        <button className="btn btn-ghost" onClick={handleExport}>
          Export
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[10rem]"
          placeholder="Search items…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as OutcomeFilter)}
        >
          <option value="all">All outcomes</option>
          <option value="wins">Wins</option>
          <option value="fair">Fair</option>
          <option value="losses">Losses</option>
        </select>
        <select
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="all">All sources</option>
          {modes.map((m) => (
            <option key={m} value={m}>
              {sourceModeLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="⌕"
          title="No trades match"
          hint="Try a different search or filter."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((rec) => (
            <HistoryRow
              key={rec.id}
              rec={rec}
              itemById={itemById}
              onDelete={async () => {
                await removeHistory(rec.id);
                notify("Trade removed", "info");
              }}
              onReuse={() => {
                loadTrade(rec.gave, rec.received);
                navigate("/calculator");
              }}
              onShare={
                communityFeedConfigured
                  ? async () => {
                      try {
                        await shareCommunityTrade(rec);
                        notify("Trade shared anonymously", "success");
                      } catch {
                        notify("Could not share this trade", "error");
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  rec,
  itemById,
  onDelete,
  onReuse,
  onShare,
}: {
  rec: TradeRecord;
  itemById: (id: string) => Item | undefined;
  onDelete: () => void | Promise<void>;
  onReuse: () => void;
  onShare?: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const verdict = verdictForRecord(rec);
  const calc = rec.calculation;

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-4">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          title={calc ? "Show saved calculation" : undefined}
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Gave</span>
            <span className="truncate font-medium">
              {summarise(rec.gave, itemById)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-sm">
            <span className="text-slate-400">Got</span>
            <span className="truncate font-medium">
              {summarise(rec.received, itemById)}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {formatDate(rec.date)} · {sourceModeLabel(rec.mode)}
            {rec.snapshotRevision !== undefined && ` · data r${rec.snapshotRevision}`}
            {rec.algorithmVersion !== undefined && ` · algo v${rec.algorithmVersion}`}
          </div>
        </button>
        <div className="text-right">
          <div
            className={
              verdict === "win" || verdict === "big-win"
                ? "font-semibold text-win"
                : verdict === "loss" || verdict === "big-loss"
                  ? "font-semibold text-loss"
                  : "font-semibold text-slate-200"
            }
          >
            {verdictLabel(verdict)}
          </div>
          <div className="text-xs tabular-nums text-slate-400">
            {formatPercent(rec.resultPercent)}
          </div>
        </div>
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onReuse}>
          Reuse
        </button>
        {onShare && (
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onShare}>
            Share anonymously
          </button>
        )}
        {confirming ? (
          <div className="flex items-center gap-1">
            <button
              className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/5"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
            <button
              className="rounded-md px-2 py-1 text-xs text-loss hover:bg-loss/20"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            className="icon-btn icon-btn-danger"
            onClick={() => setConfirming(true)}
            aria-label="Delete saved trade"
            title="Delete"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      {expanded && calc && <CalculationDetail calc={calc} />}
    </div>
  );
}

function CalculationDetail({
  calc,
}: {
  calc: NonNullable<TradeRecord["calculation"]>;
}) {
  const lines = [...calc.gave, ...calc.received];
  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-white/5 pt-3 text-xs">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-400">
        <span>
          Given{" "}
          <span className="tabular-nums text-slate-200">
            {formatValue(calc.yourTotal)}
          </span>
        </span>
        <span>
          Received{" "}
          <span className="tabular-nums text-slate-200">
            {formatValue(calc.theirTotal)}
          </span>
        </span>
        <span>
          Fair band ±
          <span className="tabular-nums text-slate-200">
            {(calc.thresholds.fairBand * 100).toFixed(1)}%
          </span>
        </span>
        <span>
          Big at ±
          <span className="tabular-nums text-slate-200">
            {(calc.thresholds.bigBand * 100).toFixed(0)}%
          </span>
        </span>
        <span>Confidence {calc.confidence}</span>
      </div>

      {calc.insights && calc.insights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {calc.insights.map((insight) => (
            <span
              key={insight.kind}
              className="chip border border-white/10 bg-white/5 px-2 py-1"
            >
              {insight.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {lines.map((line, i) => (
          <div
            key={`${line.itemId}-${i}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="truncate text-slate-300">
              {line.displayName}
              {line.quantity > 1 && ` ×${line.quantity}`}
            </span>
            <span className="shrink-0 text-slate-500">
              {line.unvalued ? (
                <span className="text-amber-400/90">no value</span>
              ) : (
                <>
                  {line.readings
                    .map((r) => `${r.source} ${formatValue(r.value)}`)
                    .join(" · ") || formatValue(line.unitValue)}
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {calc.warnings.length > 0 && (
        <ul className="mt-1 flex list-inside list-disc flex-col gap-0.5 text-amber-400/80">
          {calc.warnings.map((w, i) => (
            <li key={`${w.kind}-${i}`}>{w.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
