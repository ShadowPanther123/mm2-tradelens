import { windowControls } from "@/services/tauri";
import { Icon } from "./Icon";

/** Custom frameless title bar with drag region and window controls. */
export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between px-3 select-none
        bg-base-800/60 backdrop-blur-md border-b border-white/5"
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-accent to-yourside text-base-900 shadow-glow">
          <Icon name="logo" className="h-3.5 w-3.5" />
        </span>
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
          <Icon name="minimize" className="h-4 w-4" />
        </button>
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={() => windowControls.toggleMaximize()}
          title="Maximize"
          aria-label="Maximize or restore window"
        >
          <Icon name="maximize" className="h-3.5 w-3.5" />
        </button>
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-loss/80 hover:text-white"
          onClick={() => windowControls.close()}
          title="Close"
          aria-label="Close window"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
