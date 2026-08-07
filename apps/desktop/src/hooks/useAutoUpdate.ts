import { useEffect, useRef } from "react";
import { useDataStore } from "@/hooks/useDataStore";
import { useToast } from "@/contexts/ToastContext";
import { logger } from "@/services/logger";
import { formatPercent, formatValue } from "@/utils/format";

/** How often to look for a fresher snapshot while the app is open. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
/** Small delay after startup before the first check, so the UI settles first. */
const STARTUP_DELAY_MS = 8000;
/**
 * How often the wake watchdog ticks. If the wall clock jumps far ahead between
 * ticks, the machine was almost certainly asleep and has just resumed, so we
 * refresh promptly rather than waiting out the remaining interval.
 */
const WAKE_TICK_MS = 30 * 1000;
const WAKE_GAP_MS = 2 * WAKE_TICK_MS + 5000;

/**
 * Keeps values gently up to date while the app is open and, when enabled,
 * surfaces a calm heads-up whenever an item's value moves. Two kinds of alert
 * fire: a percentage move on a watched (favorited) item, and an absolute move
 * of the chosen size on any item at all. Entirely best-effort and offline-safe.
 *
 * Beyond the periodic timer it also reacts to the machine coming back online
 * and to the device waking from sleep, so a laptop reopened after a while shows
 * fresh values without the user having to ask.
 */
export function useAutoUpdate() {
  const ready = useDataStore((s) => s.ready);
  const offlineMode = useDataStore((s) => s.settings.offlineMode);
  const notificationsEnabled = useDataStore((s) => s.settings.notificationsEnabled);
  const threshold = useDataStore((s) => s.settings.notifyThresholdPercent);
  const absThreshold = useDataStore((s) => s.settings.alertAbsoluteThreshold);
  const checkForUpdates = useDataStore((s) => s.checkForUpdates);
  const { notify } = useToast();

  // Keep the latest notification prefs in a ref so the interval closure stays
  // stable but always reads current values.
  const prefs = useRef({ notificationsEnabled, threshold, absThreshold });
  prefs.current = { notificationsEnabled, threshold, absThreshold };

  useEffect(() => {
    if (!ready || offlineMode) return;

    let cancelled = false;
    // Serialise triggers from the several event sources below so we never fire
    // overlapping checks (the store also guards, but this avoids the churn).
    let inFlight = false;

    async function runCheck(reason: string) {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result = await checkForUpdates();
        if (cancelled || !result.updated) return;
        logger.info("auto-update", `refreshed via ${reason} → revision ${result.revision}`);

        const { notificationsEnabled: on, threshold: limit, absThreshold: minMove } =
          prefs.current;
        if (!on) return;

        // Watchlist: favorites that moved beyond the percentage threshold.
        const notableFavs = result.movedFavorites
          .filter((m) => Math.abs(m.changePercent) >= limit)
          .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
        const favIds = new Set(notableFavs.map((m) => m.item.id));

        for (const m of notableFavs.slice(0, 3)) {
          const easing = m.changePercent < 0;
          notify(
            `${m.item.displayName} ${easing ? "eased" : "moved up"} ${formatPercent(m.changePercent)}`,
            easing ? "info" : "success",
          );
        }

        // Market-wide: any item (pet, chroma, unique, vintage, ancient — any
        // item at all) that moved by the absolute threshold, excluding ones
        // already surfaced above so we never double-notify.
        const movers = result.movedItems.filter((m) => !favIds.has(m.item.id));
        for (const m of movers.slice(0, 3)) {
          const dropped = m.change < 0;
          notify(
            `${m.item.displayName} ${dropped ? "dropped" : "rose"} ${formatValue(
              Math.abs(m.change),
            )} → ${formatValue(m.to)}`,
            dropped ? "info" : "success",
          );
        }
        const remaining = movers.length - Math.min(3, movers.length);
        if (remaining > 0) {
          notify(`+${remaining} more item${remaining === 1 ? "" : "s"} moved ${minMove}+`, "info");
        }
      } finally {
        inFlight = false;
      }
    }

    const startup = setTimeout(() => void runCheck("startup"), STARTUP_DELAY_MS);
    const interval = setInterval(() => void runCheck("interval"), CHECK_INTERVAL_MS);

    // Network reconnect: check as soon as connectivity returns.
    const onOnline = () => {
      logger.info("auto-update", "network reconnected");
      void runCheck("reconnect");
    };
    window.addEventListener("online", onOnline);

    // Wake-from-sleep watchdog: detect a large wall-clock gap between ticks
    // (which indicates the OS suspended the app) and refresh on resume.
    let lastTick = Date.now();
    const wake = setInterval(() => {
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;
      if (gap > WAKE_GAP_MS) {
        logger.info("auto-update", `resumed after ~${Math.round(gap / 1000)}s asleep`);
        void runCheck("resume");
      }
    }, WAKE_TICK_MS);

    return () => {
      cancelled = true;
      clearTimeout(startup);
      clearInterval(interval);
      clearInterval(wake);
      window.removeEventListener("online", onOnline);
    };
  }, [ready, offlineMode, checkForUpdates, notify]);
}
