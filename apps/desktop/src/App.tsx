import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { TitleBar, Sidebar, ToastViewport, Onboarding } from "@/components";
import { Dashboard } from "@/pages";
import { useDataStore } from "@/hooks/useDataStore";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { focusWindow, onToggleOverlay } from "@/services/tauri";

// Only the landing route (Dashboard) is eager. Every other page is split into
// its own chunk and loaded on first navigation, keeping the startup bundle lean.
const Search = lazy(() => import("@/pages/Search").then((m) => ({ default: m.Search })));
const Calculator = lazy(() =>
  import("@/pages/Calculator").then((m) => ({ default: m.Calculator })),
);
const Trends = lazy(() => import("@/pages/Trends").then((m) => ({ default: m.Trends })));
const ItemDetails = lazy(() =>
  import("@/pages/ItemDetails").then((m) => ({ default: m.ItemDetails })),
);
const Favorites = lazy(() =>
  import("@/pages/Favorites").then((m) => ({ default: m.Favorites })),
);
const History = lazy(() => import("@/pages/History").then((m) => ({ default: m.History })));
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);

// The scan page pulls in the (large) OCR engine, so load it on demand to keep
// it out of the initial bundle.
const OcrScan = lazy(() =>
  import("@/pages/OcrScan").then((m) => ({ default: m.OcrScan })),
);

function Loader({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid h-full w-full place-items-center text-sm text-slate-400"
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-accent"
        />
        {message}
      </span>
    </div>
  );
}

/** Calm recovery screen shown when the app can't finish starting up. */
function StartupError() {
  return (
    <div className="grid h-full w-full place-items-center p-6">
      <div role="alert" className="card flex max-w-md flex-col gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold text-white">We couldn't finish loading</h1>
        <p className="text-sm text-slate-400">
          TradeLens had trouble reading its local data. Reloading usually helps. If it
          keeps happening, you can rebuild the database from Settings once you're back in.
        </p>
        <button className="btn self-center" onClick={() => window.location.reload()}>
          Reload app
        </button>
      </div>
    </div>
  );
}

export function App() {
  const ready = useDataStore((s) => s.ready);
  const loading = useDataStore((s) => s.loading);
  const error = useDataStore((s) => s.error);
  const init = useDataStore((s) => s.init);
  const theme = useDataStore((s) => s.settings.theme);

  useAutoUpdate();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
  }, [theme]);

  // Global hotkey (Ctrl+Shift+M) brings the window forward.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onToggleOverlay(() => {
      void focusWindow();
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-base-900/85 backdrop-blur-2xl">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {error ? (
            <StartupError />
          ) : !ready && loading ? (
            <Loader message="Loading values…" />
          ) : (
            <Suspense fallback={<Loader message="Loading…" />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/search" element={<Search />} />
                <Route path="/calculator" element={<Calculator />} />
                <Route path="/scan" element={<OcrScan />} />
                <Route path="/trends" element={<Trends />} />
                <Route path="/item/:id" element={<ItemDetails />} />
                <Route path="/favorites" element={<Favorites />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          )}
        </main>
      </div>
      <ToastViewport />
      {ready && <Onboarding />}
    </div>
  );
}
