import { useEffect, useState } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { useToast } from "@/contexts/ToastContext";
import { ToggleSwitch, ConfirmDialog, SupremeSourceStatus } from "@/components";
import { setAlwaysOnTop, setOverlaySize } from "@/services/tauri";
import {
  updateStatusMessage,
  signaturesEnforced,
  isUnverifiedDevelopmentFeed,
} from "@/services/updates";
import { snapshotIsStale } from "@/hooks/useDataStore";
import { describeError, downloadDiagnostics, logger } from "@/services/logger";
import { getAppInfo } from "@/database";
import type { AppInfo, OverlaySize, SourceMode } from "@/types";
import { cn } from "@/utils/cn";
import { formatRelative } from "@/utils/format";

const SOURCE_MODES: Array<{ id: SourceMode; label: string }> = [
  { id: "supreme", label: "Supreme Values" },
  { id: "mm2values", label: "MM2Values" },
  { id: "compare-both", label: "Compare Both" },
  { id: "consensus", label: "Combined estimate" },
];

const OVERLAY_SIZES: Array<{ id: OverlaySize; label: string }> = [
  { id: "mini", label: "Mini" },
  { id: "trade", label: "Trade" },
  { id: "expanded", label: "Expanded" },
];

const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
] as const;

export function Settings() {
  const settings = useDataStore((s) => s.settings);
  const updateSettings = useDataStore((s) => s.updateSettings);
  const refresh = useDataStore((s) => s.refresh);
  const clearAll = useDataStore((s) => s.clearAll);
  const resetData = useDataStore((s) => s.resetData);
  const checkForUpdates = useDataStore((s) => s.checkForUpdates);
  const checking = useDataStore((s) => s.checking);
  const lastCheckedAt = useDataStore((s) => s.lastCheckedAt);
  const lastUpdatedAt = useDataStore((s) => s.lastUpdatedAt);
  const snapshotMeta = useDataStore((s) => s.snapshotMeta);
  const isSampleData = useDataStore((s) => s.isSampleData);
  const { notify } = useToast();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  async function doCheckForUpdates() {
    const result = await checkForUpdates();
    const level = result.updated
      ? "success"
      : result.status === "database-error" ||
          result.status === "signature-failure" ||
          result.status === "invalid-data"
        ? "error"
        : "info";
    notify(updateStatusMessage(result.status), level);
  }

  async function pickOverlay(size: OverlaySize) {
    await updateSettings({ overlaySize: size });
    await setOverlaySize(size).catch((err) =>
      logger.warn("settings", "could not resize overlay", describeError(err)),
    );
  }

  async function toggleAlwaysOnTop(value: boolean) {
    try {
      await setAlwaysOnTop(value);
      await updateSettings({ alwaysOnTop: value });
      notify(value ? "Window will stay on top" : "Window can go behind others", "info");
    } catch (err) {
      logger.warn("settings", "could not set always-on-top", describeError(err));
      notify("Could not change the window setting", "error");
    }
  }

  async function doClear() {
    await clearAll();
    await Promise.all([setAlwaysOnTop(true), setOverlaySize("trade")]).catch((err) =>
      logger.warn(
        "settings",
        "could not apply reset window settings",
        describeError(err),
      ),
    );
    setConfirmClear(false);
    notify("All local data cleared", "success");
  }

  async function doReset() {
    try {
      await resetData();
      await Promise.all([setAlwaysOnTop(true), setOverlaySize("trade")]).catch((err) =>
        logger.warn(
          "settings",
          "could not apply rebuilt window settings",
          describeError(err),
        ),
      );
      setConfirmReset(false);
      notify("Database rebuilt and reset", "success");
    } catch (err) {
      notify(`Reset failed: ${(err as Error).message ?? String(err)}`, "error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <div>
          <div className="mb-2 text-sm text-slate-300">Theme</div>
          <div className="inline-flex rounded-lg border border-line bg-base-800/60 p-1">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                aria-pressed={settings.theme === theme.id}
                onClick={() => updateSettings({ theme: theme.id })}
                className={cn(
                  "min-w-20 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  settings.theme === theme.id
                    ? "bg-accent text-base-900 shadow-sm"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-sm font-semibold">Values</h2>

        <div>
          <div className="mb-2 text-sm text-slate-300">Value source</div>
          <div className="flex flex-wrap gap-2">
            {SOURCE_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => updateSettings({ sourceMode: m.id })}
                className={cn(
                  "chip border px-3 py-1.5",
                  settings.sourceMode === m.id
                    ? "border-accent/50 bg-accent/15 text-white"
                    : "border-line text-slate-400 hover:text-slate-200",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          {settings.sourceMode === "consensus" && (
            <p className="mt-2 text-xs text-slate-600">
              The combined estimate is the plain average of every available source
              reading (for example 100 and 120 combine to 110), rounded to the nearest
              whole value for display. The individual source readings are always shown
              alongside it — it&apos;s a guide, not an official value.
            </p>
          )}
        </div>

        <label className="flex items-center justify-between gap-4 text-sm">
          <span className="flex flex-col">
            <span className="text-slate-300">Disagreement threshold (%)</span>
            <span className="text-xs text-slate-600">
              Flag when Supreme Values and MM2Values differ by more than this.
            </span>
          </span>
          <input
            type="number"
            min={1}
            max={100}
            className="input w-24"
            value={settings.disagreementThresholdPercent}
            onChange={(e) =>
              updateSettings({
                disagreementThresholdPercent: Number(e.target.value) || 5,
              })
            }
          />
        </label>

        <ToggleSwitch
          label="Offline mode"
          hint="Only use cached values; don't check for updates."
          checked={settings.offlineMode}
          onChange={(v) => updateSettings({ offlineMode: v })}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn"
            disabled={settings.offlineMode || checking}
            onClick={doCheckForUpdates}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await refresh();
              notify("Values refreshed from cache", "info");
            }}
          >
            Refresh from cache
          </button>
          {lastCheckedAt && (
            <span className="text-xs text-slate-500">
              Last checked {formatRelative(lastCheckedAt)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            Data status:{" "}
            <span className="text-slate-300">
              {isSampleData
                ? "Bundled sample (placeholder figures)"
                : snapshotMeta && snapshotIsStale(snapshotMeta)
                  ? "Cached — getting old"
                  : snapshotMeta
                    ? "Cached values"
                    : "—"}
            </span>
          </span>
          <span>
            Update verification:{" "}
            <span className="text-slate-300">
              {signaturesEnforced
                ? "Signature-verified"
                : isUnverifiedDevelopmentFeed
                  ? "Development feed — unverified"
                  : "Offline — signed feed not configured"}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            Current data revision:{" "}
            <span className="text-slate-300">{snapshotMeta?.revision ?? "—"}</span>
          </span>
          <span>
            Last successful update:{" "}
            <span className="text-slate-300">
              {lastUpdatedAt ? formatRelative(lastUpdatedAt) : "not yet this session"}
            </span>
          </span>
        </div>
        {!settings.offlineMode && (
          <p className="text-xs text-slate-600">
            When online, values top up automatically about every 15 minutes. Value
            estimates are advisory community figures, not guaranteed prices.
          </p>
        )}
      </section>

      <SupremeSourceStatus />

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-sm font-semibold">Window</h2>

        <div>
          <div className="mb-2 text-sm text-slate-300">Overlay size</div>
          <div className="flex gap-2">
            {OVERLAY_SIZES.map((s) => (
              <button
                key={s.id}
                onClick={() => pickOverlay(s.id)}
                className={cn(
                  "chip border px-3 py-1.5",
                  settings.overlaySize === s.id
                    ? "border-accent/50 bg-accent/15 text-white"
                    : "border-line text-slate-400 hover:text-slate-200",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <ToggleSwitch
          label="Always on top"
          hint="Keep the window above other apps for quick reference."
          checked={settings.alwaysOnTop}
          onChange={toggleAlwaysOnTop}
        />
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <ToggleSwitch
          label="Value change alerts"
          hint="Get a heads-up when values move — favorites and any item across the board."
          checked={settings.notificationsEnabled}
          onChange={(v) => updateSettings({ notificationsEnabled: v })}
        />
        {settings.notificationsEnabled && (
          <>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="flex flex-col">
                <span className="text-slate-300">Favorite alert threshold (%)</span>
                <span className="text-xs text-slate-600">
                  Percentage move on a favorited item.
                </span>
              </span>
              <input
                type="number"
                min={1}
                max={100}
                className="input w-24"
                value={settings.notifyThresholdPercent}
                onChange={(e) =>
                  updateSettings({
                    notifyThresholdPercent: Number(e.target.value) || 5,
                  })
                }
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="flex flex-col">
                <span className="text-slate-300">Any-item alert (value change ≥)</span>
                <span className="text-xs text-slate-600">
                  Absolute move on any item — pet, chroma, unique, vintage, ancient.
                </span>
              </span>
              <input
                type="number"
                min={1}
                className="input w-24"
                value={settings.alertAbsoluteThreshold}
                onChange={(e) =>
                  updateSettings({
                    alertAbsoluteThreshold: Number(e.target.value) || 5,
                  })
                }
              />
            </label>
          </>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Data</h2>

        <label className="flex items-center justify-between gap-4 text-sm">
          <span className="flex flex-col">
            <span className="text-slate-300">Keep at most (trades)</span>
            <span className="text-xs text-slate-600">
              Automatically prune the oldest saved trades beyond this many. 0 keeps
              every trade.
            </span>
          </span>
          <input
            type="number"
            min={0}
            max={100000}
            className="input w-24"
            value={settings.historyRetentionLimit}
            onChange={(e) =>
              updateSettings({
                historyRetentionLimit: Math.max(
                  0,
                  Math.floor(Number(e.target.value) || 0),
                ),
              })
            }
          />
        </label>

        <div className="border-t border-white/5 pt-3">
          <button
            className="btn btn-danger self-start"
            onClick={() => setConfirmClear(true)}
          >
            Delete all local data
          </button>
        </div>

        <div className="mt-2 border-t border-white/5 pt-3">
          <p className="mb-2 text-xs text-slate-500">
            If the app misbehaves after an update, rebuild the database from scratch.
            This removes all local data and cannot be undone.
          </p>
          <button
            className="btn btn-ghost self-start"
            onClick={() => setConfirmReset(true)}
          >
            Reset database
          </button>
        </div>

        <div className="mt-2 border-t border-white/5 pt-3">
          <p className="mb-2 text-xs text-slate-500">
            Export a diagnostics file (recent activity and error logs) to help with
            troubleshooting. It stays on your device unless you choose to share it, and
            never includes your favorites or trade history.
          </p>
          <button
            className="btn btn-ghost self-start"
            onClick={() => {
              downloadDiagnostics({ dataRevision: snapshotMeta?.revision ?? null });
              notify("Diagnostics exported", "success");
            }}
          >
            Export diagnostics
          </button>
        </div>
      </section>

      <div className="px-1 text-xs text-slate-600">
        {info ? `${info.name} v${info.version}` : "MM2 TradeLens"} · Independent fan
        project. Not affiliated with Roblox, Nikilis, MM2Values or Supreme Values. Never
        modifies or automates the Roblox client. Value estimates are advisory and may be
        incomplete or out of date.
      </div>

      <ConfirmDialog
        open={confirmClear}
        danger
        title="Delete all local data?"
        message="This removes all favorites and saved trade history from this device. This can't be undone."
        confirmLabel="Yes, delete"
        onConfirm={doClear}
        onCancel={() => setConfirmClear(false)}
      />
      <ConfirmDialog
        open={confirmReset}
        danger
        title="Reset database?"
        message="This rebuilds the local database from scratch and erases all local data. This can't be undone."
        confirmLabel="Yes, rebuild"
        onConfirm={doReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
