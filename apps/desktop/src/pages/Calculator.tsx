import { useState } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { useTradeStore } from "@/hooks/useTradeStore";
import { useTradeResult } from "@/hooks/useTradeResult";
import { useToast } from "@/contexts/ToastContext";
import { TradeSideCard, VerdictCard } from "@/components";
import { toTradeCalculation } from "@tradelens/trade-engine";
import type { TradeRecord } from "@/types";

export function Calculator() {
  const mode = useDataStore((s) => s.settings.sourceMode);
  const addHistory = useDataStore((s) => s.addHistory);
  const snapshotRevision = useDataStore((s) => s.snapshot?.revision);
  const your = useTradeStore((s) => s.your);
  const their = useTradeStore((s) => s.their);
  const clear = useTradeStore((s) => s.clear);
  const result = useTradeResult();
  const { notify } = useToast();
  const [confirmingClear, setConfirmingClear] = useState(false);

  const canSave = your.length > 0 && their.length > 0;
  const hasItems = your.length > 0 || their.length > 0;

  async function save() {
    const record: TradeRecord = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      gave: your,
      received: their,
      resultPercent: result.differencePercent,
      mode,
      algorithmVersion: result.algorithmVersion,
      snapshotRevision,
      // Freeze the full calculation so this record stays faithful to what the
      // user saw, even after values or the algorithm change later.
      calculation: toTradeCalculation(result),
    };
    await addHistory(record);
    notify("Trade saved to history", "success");
  }

  function handleClear() {
    // Removing everything is easy to do by accident, so confirm first.
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    clear();
    setConfirmingClear(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Trade calculator</h1>
          <p className="text-sm text-slate-500">Compare what you give and receive.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {confirmingClear && (
            <span className="text-sm text-slate-500">Clear all items?</span>
          )}
          {confirmingClear ? (
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmingClear(false)}>
                Keep
              </button>
              <button className="btn btn-danger" onClick={handleClear}>
                Clear all
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={handleClear}
              disabled={!hasItems}
            >
              Clear
            </button>
          )}
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>
            Save trade
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TradeSideCard side="your" title="Your offer" total={result.your.total} mode={mode} />
        <TradeSideCard
          side="their"
          title="Their offer"
          total={result.their.total}
          mode={mode}
        />
      </div>

      <VerdictCard result={result} />
    </div>
  );
}
