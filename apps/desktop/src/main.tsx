import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "@/App";
import { ErrorBoundary } from "@/components";
import { ToastProvider } from "@/contexts/ToastContext";
import { describeError, logger } from "@/services/logger";
import "./index.css";

// Capture otherwise-unhandled failures so nothing important is swallowed.
window.addEventListener("error", (event) => {
  logger.error("window", event.message || "uncaught error", {
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});
window.addEventListener("unhandledrejection", (event) => {
  const { kind, message } = describeError(event.reason);
  logger.error("promise", `unhandled rejection: ${message}`, { kind });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>,
);
