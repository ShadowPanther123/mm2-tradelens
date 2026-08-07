import { useDataStore } from "@/hooks/useDataStore";

/**
 * A calm, clear label shown while the app is running on the bundled sample
 * snapshot — so demonstration figures are never mistaken for live values.
 */
export function SampleDataBanner() {
  const isSampleData = useDataStore((s) => s.isSampleData);
  if (!isSampleData) return null;

  return (
    <div
      role="status"
      className="banner border-line bg-slate-500/10 text-slate-300"
    >
      <span className="text-base" aria-hidden="true">◈</span>
      <span>
        Showing bundled sample data for demonstration — these are placeholder figures, not
        live Supreme Values or MM2Values. Check for updates to load current values.
      </span>
    </div>
  );
}
