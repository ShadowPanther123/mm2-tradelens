import type { ValueSnapshot } from "@tradelens/item-schema";
import { parseSnapshot } from "@tradelens/item-schema";
import data from "./mm2values-snapshot.json" with { type: "json" };

/**
 * Bundled MM2Values snapshot, generated from a licensed CSV export by
 * `scripts/generate-mm2values.mjs`. Unlike the illustrative {@link sampleSnapshot},
 * these are real source values, so the app ships them as trusted data.
 *
 * The JSON is validated against the canonical schema at module load, turning
 * any drift between the generator and the schema into an immediate, loud error
 * rather than a subtle runtime bug.
 */
export const mm2valuesSnapshot: ValueSnapshot = parseSnapshot(data);

/** Convenience accessor for the bundled items. */
export const mm2valuesItems = mm2valuesSnapshot.items;
