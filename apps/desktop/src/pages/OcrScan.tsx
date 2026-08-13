import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDataStore } from "@/hooks/useDataStore";
import { useTradeStore } from "@/hooks/useTradeStore";
import { useToast } from "@/contexts/ToastContext";
import {
  disposeOcr,
  OCR_ENABLED,
  OcrCancelledError,
  recognizeImage,
  type OcrProgress,
} from "@/services/ocr";
import { analyzeOcr, type OcrCandidate } from "@/services/ocrMatch";
import { validateImageFile } from "@/services/ocrInput";
import { RarityBadge, ValueBadge } from "@/components";
import { cn } from "@/utils/cn";
import type { Item } from "@/types";

/** One row in the editable review list, seeded from an OCR candidate. */
interface ReviewEntry extends OcrCandidate {
  /** Stable key so React keeps row state while the user edits. */
  key: string;
}

const IDLE_PROGRESS: OcrProgress = { phase: "loading", progress: 0, label: "" };

export function OcrScan() {
  const index = useDataStore((s) => s.index);
  const mode = useDataStore((s) => s.settings.sourceMode);
  const add = useTradeStore((s) => s.add);
  const { notify } = useToast();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OcrProgress>(IDLE_PROGRESS);
  const [rawText, setRawText] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewEntry[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Release the OCR worker and cancel any in-flight run when leaving the screen.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void disposeOcr();
    };
  }, []);

  function loadFile(file: File) {
    const check = validateImageFile({
      type: file.type,
      size: file.size,
      name: file.name,
    });
    if (!check.ok) {
      notify(check.reason, "warn");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(reader.result as string);
      setRawText(null);
      setReview(null);
    };
    reader.onerror = () => notify("Couldn't open that file.", "error");
    reader.readAsDataURL(file);
  }

  function cancelOcr() {
    abortRef.current?.abort();
  }

  async function runOcr() {
    if (!imageUrl) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({ phase: "loading", progress: 0, label: "Preparing text engine…" });
    setRawText(null);
    setReview(null);
    try {
      const result = await recognizeImage(imageUrl, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      setRawText(result.text.trim());
      const candidates = analyzeOcr(index, result.words);
      // Never add anything automatically — only offer the results for review.
      setReview(candidates.map((c) => ({ ...c, key: c.item.id })));
      notify(
        candidates.length > 0
          ? `Found ${candidates.length} possible item${candidates.length === 1 ? "" : "s"} to review.`
          : "No items recognised — try a clearer or larger image.",
        candidates.length > 0 ? "success" : "info",
      );
    } catch (err) {
      if (err instanceof OcrCancelledError) {
        notify("Scan cancelled.", "info");
      } else {
        notify(`Couldn't read that image: ${(err as Error).message}`, "error");
      }
    } finally {
      setRunning(false);
      setProgress(IDLE_PROGRESS);
      abortRef.current = null;
    }
  }

  function addMatch(item: Item, side: "your" | "their") {
    add(side, item.id);
    notify(
      `Added ${item.displayName} to ${side === "your" ? "your" : "their"} side.`,
      "success",
    );
  }

  /** Swap a reviewed row to one of its alternative matches. */
  function useAlternative(key: string, alt: { item: Item; score: number }) {
    setReview((prev) =>
      (prev ?? []).map((entry) =>
        entry.key === key
          ? {
              ...entry,
              item: alt.item,
              score: alt.score,
              uncertain: alt.score <= 0.85,
              alternatives: [
                { item: entry.item, score: entry.score },
                ...entry.alternatives.filter((a) => a.item.id !== alt.item.id),
              ].slice(0, 3),
            }
          : entry,
      ),
    );
  }

  /** Remove a row the user does not want. */
  function removeEntry(key: string) {
    setReview((prev) => (prev ?? []).filter((entry) => entry.key !== key));
  }

  if (!OCR_ENABLED) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Scan a screenshot</h1>
        <p className="card p-4 text-sm text-slate-400">
          Screenshot scanning isn't included in this build. You can still add items from
          the{" "}
          <Link to="/calculator" className="text-accent hover:underline">
            calculator
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-5"
      onPaste={(e) => {
        const file = Array.from(e.clipboardData.files)[0];
        if (file) loadFile(file);
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">Scan a screenshot</h1>
        <p className="text-sm text-slate-500">
          Drop in a screenshot of your trade window and TradeLens will try to read the
          item names for you. Your image stays on your device.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = Array.from(e.dataTransfer.files)[0];
          if (file) loadFile(file);
        }}
        className={cn(
          "card flex flex-col items-center justify-center gap-3 border-2 border-dashed p-8 text-center transition-colors",
          dragOver ? "border-accent/60 bg-accent/5" : "border-line",
        )}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Screenshot to scan"
            className="max-h-64 rounded-xl border border-white/10 object-contain"
          />
        ) : (
          <div className="text-4xl text-slate-600 opacity-60" aria-hidden="true">
            ▣
          </div>
        )}
        <div className="text-sm text-slate-400">
          Drag &amp; drop an image, paste from clipboard, or
        </div>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          Choose image…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {imageUrl && (
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={runOcr} disabled={running}>
            {running ? "Reading…" : "Read item names"}
          </button>
          {running ? (
            <button className="btn btn-ghost" onClick={cancelOcr}>
              Cancel
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setImageUrl(null);
                setRawText(null);
                setReview(null);
              }}
            >
              Clear
            </button>
          )}
          {running && progress.label && (
            <span className="text-xs text-slate-500">
              {progress.label} {Math.round(progress.progress * 100)}%
            </span>
          )}
        </div>
      )}

      {running && (
        <div
          role="progressbar"
          aria-label={progress.label || "Reading item names"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.progress * 100)}
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${Math.round(progress.progress * 100)}%` }}
          />
        </div>
      )}

      {rawText !== null && (
        <section className="card p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Review detected items</h2>
            <Link to="/calculator" className="text-xs text-accent hover:underline">
              Open calculator
            </Link>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Nothing is added automatically. Check each match, pick an alternative if
            needed, then add the ones you want.
          </p>

          {!review || review.length === 0 ? (
            <p className="py-3 text-center text-sm text-slate-500">
              Nothing matched confidently. Try a sharper crop of just the item names.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {review.map((entry) => (
                <div
                  key={entry.key}
                  className={cn(
                    "glass-soft flex flex-col gap-2 rounded-xl px-3 py-2.5",
                    entry.uncertain && "ring-1 ring-amber-400/40",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/item/${entry.item.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {entry.item.displayName}
                        </Link>
                        <RarityBadge rarity={entry.item.rarity} />
                        {entry.uncertain && (
                          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                            Uncertain
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {Math.round(entry.score * 100)}% match · read “
                        {entry.sourceText}”
                      </div>
                    </div>
                    <ValueBadge item={entry.item} mode={mode} />
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => addMatch(entry.item, "your")}
                      >
                        + Yours
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => addMatch(entry.item, "their")}
                      >
                        + Theirs
                      </button>
                      <button
                        className="btn btn-ghost btn-sm text-slate-400"
                        aria-label={`Remove ${entry.item.displayName} from review`}
                        title="Remove from review"
                        onClick={() => removeEntry(entry.key)}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </div>
                  </div>

                  {entry.alternatives.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2 text-xs text-slate-500">
                      <span>Did you mean</span>
                      {entry.alternatives.map((alt) => (
                        <button
                          key={alt.item.id}
                          className="rounded-full bg-white/5 px-2 py-0.5 hover:bg-white/10 hover:text-slate-200"
                          onClick={() => useAlternative(entry.key, alt)}
                        >
                          {alt.item.displayName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {rawText.length > 0 && (
            <details className="mt-4 text-xs text-slate-500">
              <summary className="cursor-pointer select-none hover:text-slate-300">
                Show recognised text
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/20 p-3">
                {rawText}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
