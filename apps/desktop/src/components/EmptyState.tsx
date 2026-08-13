interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
}

/** Friendly placeholder for empty lists. */
export function EmptyState({ icon = "◌", title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="text-3xl text-slate-600" aria-hidden="true">
        {icon}
      </span>
      <p className="font-medium text-slate-300">{title}</p>
      {hint && <p className="max-w-xs text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
