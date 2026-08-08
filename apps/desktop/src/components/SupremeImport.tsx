import { useRef, useState } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { useToast } from "@/contexts/ToastContext";
import { describeError, logger } from "@/services/logger";
import { cn } from "@/utils/cn";

/** Cap the accepted capture so a stray huge file can't stall the UI (8 MiB). */
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

/**
 * In-app Supreme Values import.
 *
 * SupremeValues cannot be fetched automatically (bot protection + client-side
 * rendering), so this lets the user bring in values they saved from their OWN
 * browser session — by dragging the saved page onto the drop zone, choosing a
 * file, or pasting the page's text/JSON. Nothing here bypasses access controls;
 * it only reads a capture the user already has and merges it into the snapshot.
 */
export function SupremeImport() {
  const importSupreme = useDataStore((s) => s.importSupreme);
  const { notify } = useToast();
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function runImport(capture: string) {
    const trimmed = capture.trim();
    if (!trimmed) {
      notify("Nothing to import — the capture was empty.", "warn");
      return;
    }
    setBusy(true);
    try {
      const report = await importSupreme(trimmed);
      const applied = report.changed + report.added;
      if (applied === 0) {
        notify(
          report.parsed === 0
            ? "Couldn't read any Supreme items from that capture."
            : "Supreme values already match — nothing to update.",
          report.parsed === 0 ? "warn" : "info",
        );
        return;
      }
      const extra = report.unmatched > 0 ? `, ${report.unmatched} unmatched` : "";
      notify(
        `Imported Supreme values: ${report.changed} updated, ${report.added} added${extra} (revision ${report.revision}).`,
        "success",
      );
    } catch (err) {
      logger.error("supreme-import", "import failed", describeError(err));
      notify(`Supreme import failed: ${(err as Error).message ?? String(err)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_CAPTURE_BYTES) {
      notify("That file is too large to import (over 8 MB).", "warn");
      return;
    }
    try {
      const text = await file.text();
      await runImport(text);
    } catch (err) {
      notify(`Couldn't read that file: ${(err as Error).message ?? String(err)}`, "error");
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="text-sm font-semibold">Import Supreme Values</h2>
      <p className="text-xs text-slate-500">
        Supreme Values can&apos;t be fetched automatically. Open the values page in your own
        browser, save it (or copy the page), then drop the file below to bring the values in.
        Only items already known to TradeLens are updated.
      </p>

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a saved Supreme Values page to import, or activate to choose a file"
        aria-busy={busy}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInput.current?.click();
          }
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-8 text-center text-sm transition-colors",
          dragging
            ? "border-accent/70 bg-accent/10 text-white"
            : "border-line text-slate-400 hover:border-slate-500 hover:text-slate-200",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <span className="font-medium">
          {busy ? "Importing…" : dragging ? "Drop to import" : "Drop a saved Supreme page here"}
        </span>
        <span className="text-xs text-slate-600">or click to choose a file (.html, .txt, .json)</span>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".html,.htm,.txt,.json,text/html,text/plain,application/json"
        className="sr-only"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setPasteOpen((v) => !v)}
        >
          {pasteOpen ? "Hide paste box" : "Paste page text instead"}
        </button>
      </div>

      {pasteOpen && (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor="supreme-paste">
            Supreme Values page text or JSON
          </label>
          <textarea
            id="supreme-paste"
            className="input min-h-[8rem] w-full font-mono text-xs"
            placeholder="Paste the copied Supreme Values page text or JSON export here…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || pasteText.trim().length === 0}
              onClick={async () => {
                await runImport(pasteText);
                setPasteText("");
              }}
            >
              {busy ? "Importing…" : "Import pasted values"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
