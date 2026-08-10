import { useCallback, useEffect, useRef, useState } from "react";

/** localStorage key that records the welcome guide has been dismissed. */
const SEEN_KEY = "tradelens:onboarding-seen";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

interface Tip {
  icon: string;
  title: string;
  body: string;
}

/** The handful of things that are worth knowing before the first use. */
const TIPS: Tip[] = [
  {
    icon: "⌨️",
    title: "Ctrl + Shift + M",
    body: "Press this from anywhere to bring TradeLens to the front while you trade — no need to hunt for the window.",
  },
  {
    icon: "◔",
    title: "It lives in your tray",
    body: "TradeLens keeps running quietly in the system tray. Click the tray icon any time to show the window or to quit for good.",
  },
  {
    icon: "✕",
    title: "Closing just hides it",
    body: "The close button tucks the window away rather than quitting, so the Ctrl + Shift + M shortcut keeps working in the background.",
  },
  {
    icon: "↻",
    title: "Check for updates",
    body: "Values top up on their own, but you can fetch the latest any time from Settings → Check for updates.",
  },
];

/** Whether the welcome guide should be shown (i.e. it hasn't been seen yet). */
function shouldShow(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return false;
  }
}

/**
 * A calm, one-time welcome shown on first run. It explains the few
 * not-obvious behaviours — the global hotkey, the tray, that closing only
 * hides the window, and where to fetch fresh values — so people aren't left
 * wondering where the app went. Dismissal is remembered in localStorage so it
 * never nags on later launches.
 */
export function Onboarding() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (shouldShow()) setOpen(true);
  }, []);

  const close = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Non-fatal: if storage is unavailable the guide simply shows again.
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    dismissRef.current?.focus();
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [close],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-base-900/70 p-4 backdrop-blur-sm">
      <div className="grid min-h-full place-items-center">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          aria-describedby="onboarding-intro"
          onKeyDown={handleKeyDown}
          className="card w-full max-w-md p-6"
        >
        <h2 id="onboarding-title" className="text-lg font-semibold text-white">
          Welcome to MM2 TradeLens
        </h2>
        <p id="onboarding-intro" className="mt-1 text-sm text-slate-400">
          A quick tour of how it stays out of your way.
        </p>

        <ul className="mt-4 flex flex-col gap-3">
          {TIPS.map((tip) => (
            <li key={tip.title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-base"
              >
                {tip.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-200">{tip.title}</div>
                <p className="text-xs leading-relaxed text-slate-400">{tip.body}</p>
              </div>
            </li>
          ))}
        </ul>

          <div className="mt-6 flex justify-end">
            <button
              ref={dismissRef}
              type="button"
              className="btn btn-primary"
              onClick={close}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
