import { Component, type ErrorInfo, type ReactNode } from "react";
import { describeError, downloadDiagnostics, logger } from "@/services/logger";

interface Props {
  children: ReactNode;
}

interface State {
  error: { kind: string; message: string } | null;
}

/**
 * Top-level error boundary. If a rendering error escapes a page, the app shows
 * a calm recovery screen instead of a blank window, records full diagnostics
 * locally, and offers a couple of gentle ways back: reload the app, or export a
 * diagnostics file to help with troubleshooting.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: describeError(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const { kind, message } = describeError(error);
    logger.error("react", `render error: ${message}`, {
      kind,
      componentStack: info.componentStack ?? undefined,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleExport = () => {
    downloadDiagnostics({ crashed: true, lastError: this.state.error ?? undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid h-full w-full place-items-center p-6">
        <div className="card flex max-w-md flex-col gap-4 p-6 text-center">
          <h1 className="text-lg font-semibold text-white">Something needs a moment</h1>
          <p className="text-sm text-slate-400">
            TradeLens ran into an unexpected problem and paused this screen to keep your
            data safe. Your favorites and history are untouched. Reloading usually sets
            things right.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button className="btn" onClick={this.handleReload}>
              Reload app
            </button>
            <button className="btn btn-ghost" onClick={this.handleExport}>
              Export diagnostics
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Diagnostics stay on your device. Share the exported file only if you want
            help troubleshooting.
          </p>
        </div>
      </div>
    );
  }
}
