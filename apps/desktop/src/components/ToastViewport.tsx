import { useToast } from "@/contexts/ToastContext";
import { cn } from "@/utils/cn";

const LEVEL_STYLES: Record<string, string> = {
  info: "border-accent/40 bg-accent/10 text-accent-soft",
  success: "border-win/40 bg-win/10 text-win",
  warn: "border-warn/40 bg-warn/10 text-warn",
  error: "border-loss/40 bg-loss/10 text-loss",
};

/** Bottom-right stack of transient notifications. */
export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          role={t.level === "error" || t.level === "warn" ? "alert" : "status"}
          aria-label={`${t.message}. Dismiss notification.`}
          className={cn(
            "pointer-events-auto max-w-xs animate-fade-in rounded-xl border px-4 py-2.5 text-left text-sm backdrop-blur-xl shadow-glass",
            LEVEL_STYLES[t.level],
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
