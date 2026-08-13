import { snapshotIsStale, useDataStore } from "@/hooks/useDataStore";
import { formatRelative } from "@/utils/format";

/** A calm heads-up shown when cached values are getting old. */
export function StalenessBanner() {
  const meta = useDataStore((s) => s.snapshotMeta);
  if (!meta || !snapshotIsStale(meta)) return null;

  return (
    <div role="status" className="banner border-warn/30 bg-warn/10 text-warn">
      <span className="text-base" aria-hidden="true">
        ⧗
      </span>
      <span>
        Cached values were generated {formatRelative(meta.generatedAt)}. They're still
        usable — just worth a second look before big trades.
      </span>
    </div>
  );
}
