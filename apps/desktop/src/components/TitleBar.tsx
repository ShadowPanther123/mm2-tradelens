import { windowControls } from "@/services/tauri";

/** Custom frameless title bar with drag region and window controls. */
export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between px-3 select-none
        bg-base-800/60 backdrop-blur-md border-b border-white/5"
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-md bg-gradient-to-br from-accent to-yourside" />
        <span data-tauri-drag-region className="text-xs font-semibold tracking-wide">
          MM2&nbsp;TradeLens
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={() => windowControls.minimize()}
          title="Minimize"
          aria-label="Minimize window"
        >
          &#8211;
        </button>
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={() => windowControls.toggleMaximize()}
          title="Maximize"
          aria-label="Maximize or restore window"
        >
          &#9633;
        </button>
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-loss/80 hover:text-white"
          onClick={() => windowControls.close()}
          title="Close"
          aria-label="Close window"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}
