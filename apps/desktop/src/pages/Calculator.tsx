import { useCallback, useEffect, useRef, useState } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { useTradeStore } from "@/hooks/useTradeStore";
import { useTradeResult } from "@/hooks/useTradeResult";
import { useToast } from "@/contexts/ToastContext";
import { TradeSideCard, VerdictCard } from "@/components";
import { toTradeCalculation } from "@tradelens/trade-engine";
import type { TradeRecord } from "@/types";
import { logger } from "@/services/logger";

const AUTO_SAVE_DELAY_MS = 1200;

function recordKey(
  record: Pick<TradeRecord, "gave" | "received" | "mode" | "snapshotRevision">,
): string {
  return JSON.stringify([
    record.mode,
    record.snapshotRevision,
    record.gave,
    record.received,
  ]);
}

function workingTradeKey(
  your: TradeRecord["gave"],
  received: TradeRecord["received"],
  mode: TradeRecord["mode"],
  snapshotRevision?: number,
): string {
  return JSON.stringify([mode, snapshotRevision, your, received]);
}

function buildTradeRecord(
  gave: TradeRecord["gave"],
  received: TradeRecord["received"],
  mode: TradeRecord["mode"],
  snapshotRevision: number | undefined,
  result: ReturnType<typeof useTradeResult>,
): TradeRecord {
  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    gave,
    received,
    resultPercent: result.differencePercent,
    mode,
    algorithmVersion: result.algorithmVersion,
    snapshotRevision,
    calculation: toTradeCalculation(result),
  };
}

export function Calculator() {
  const mode = useDataStore((s) => s.settings.sourceMode);
  const addHistory = useDataStore((s) => s.addHistory);
  const history = useDataStore((s) => s.history);
  const snapshotRevision = useDataStore((s) => s.snapshot?.revision);
  const your = useTradeStore((s) => s.your);
  const their = useTradeStore((s) => s.their);
  const clear = useTradeStore((s) => s.clear);
  const result = useTradeResult();
  const { notify } = useToast();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const autoSavedKey = useRef<string | null>(null);

  const canSave = your.length > 0 && their.length > 0;
  const hasItems = your.length > 0 || their.length > 0;

  const save = useCallback(async () => {
    const record = buildTradeRecord(your, their, mode, snapshotRevision, result);
    const key = recordKey(record);
    if (
      autoSavedKey.current !== key &&
      !history.some((saved) => recordKey(saved) === key)
    ) {
      autoSavedKey.current = key;
      try {
        await addHistory({
          ...record,
          id: crypto.randomUUID(),
          date: new Date().toISOString(),
        });
      } catch (error) {
        if (autoSavedKey.current === key) autoSavedKey.current = null;
        throw error;
      }
    }
    notify("Trade saved to history", "success");
  }, [addHistory, history, mode, notify, result, snapshotRevision, their, your]);

  useEffect(() => {
    if (!canSave) return;
    const key = workingTradeKey(your, their, mode, snapshotRevision);
    if (
      autoSavedKey.current === key ||
      history.some((saved) => recordKey(saved) === key)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const record = buildTradeRecord(your, their, mode, snapshotRevision, result);
      autoSavedKey.current = key;
      void addHistory({
        ...record,
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
      })
        .then(() => {
          autoSavedKey.current = key;
        })
        .catch((error) => {
          if (autoSavedKey.current === key) autoSavedKey.current = null;
          logger.warn("history", "could not automatically save calculation", {
            detail: String(error),
          });
        });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [addHistory, canSave, history, mode, result, snapshotRevision, their, your]);

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
          <p className="text-xs text-slate-600">
            Completed calculations save automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {confirmingClear && (
            <span className="text-sm text-slate-500">Clear all items?</span>
          )}
          {confirmingClear ? (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmingClear(false)}
              >
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
        <TradeSideCard
          side="your"
          title="Your offer"
          total={result.your.total}
          mode={mode}
        />
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
