import type { Item, SourceId } from "@tradelens/item-schema";
import { slugify } from "./index.js";

/**
 * Automated data audits over a set of canonical items. Every check is a pure
 * function so it can run in CI, in the updater before publishing, and in tests.
 * Nothing here throws — problems are reported so a human can decide.
 */

export interface DuplicateGroup {
  /** The normalised key that collided (id, name or alias). */
  key: string;
  /** Item ids that share the key. */
  itemIds: string[];
}

export interface ConflictReport {
  itemId: string;
  displayName: string;
  /** Largest relative gap between sources, 0–1. */
  disagreement: number;
  readings: Array<{ source: SourceId; value: number }>;
}

/** A field whose value disagrees across items that share a display name. */
export interface FieldConflict {
  /** The normalised display name the items share. */
  name: string;
  /** Item ids in the colliding group. */
  itemIds: string[];
  /** The distinct values seen for the field. */
  values: string[];
}

/** A single bad reading flagged by a value or timestamp check. */
export interface ReadingIssue {
  itemId: string;
  source: SourceId;
  detail: string;
}

/** An item reading whose value moved dramatically versus its previous value. */
export interface ExtremeChange {
  itemId: string;
  source: SourceId;
  from: number;
  to: number;
  changePercent: number;
}

/** A record a source published that could not be mapped into the catalogue. */
export interface UnmappedRecord {
  source: SourceId;
  name?: string;
  reason: string;
}

export interface AuditReport {
  itemCount: number;
  /** Items whose id is not a clean slug of their display name. */
  nonCanonicalIds: string[];
  /** Ids appearing on more than one item. */
  duplicateIds: DuplicateGroup[];
  /** Display names (normalised) shared by multiple items. */
  duplicateNames: DuplicateGroup[];
  /** Aliases shared by multiple items, or an alias equal to another item's name. */
  duplicateAliases: DuplicateGroup[];
  /** Same-named items that disagree on category. */
  conflictingCategories: FieldConflict[];
  /** Same-named items that disagree on rarity. */
  conflictingRarities: FieldConflict[];
  /** Same-named items that disagree on item type (chroma variant status). */
  conflictingTypes: FieldConflict[];
  /** Readings with an impossible or negative value. */
  impossibleValues: ReadingIssue[];
  /** Readings whose value moved beyond the extreme-change factor. */
  extremeChanges: ExtremeChange[];
  /** Readings with a timestamp in the future. */
  futureTimestamps: ReadingIssue[];
  /** Readings missing a required source timestamp. */
  missingTimestamps: ReadingIssue[];
  /** Source records that could not be mapped into the catalogue. */
  unmappedRecords: UnmappedRecord[];
  /** Items with no image set. */
  missingImages: string[];
  /** Items whose image path is malformed. */
  brokenImagePaths: string[];
  /** Groups of items that share an identical image (by hash, or path). */
  duplicateImages: DuplicateGroup[];
  /** Items missing a required source reading. */
  missingBySource: Record<SourceId, string[]>;
  /** Items present in exactly one source. */
  sourceOnly: Array<{ itemId: string; source: SourceId }>;
  /** Items whose sources disagree beyond the given threshold. */
  conflicts: ConflictReport[];
  /** Items flagged unverified / manually entered. */
  unverified: string[];
  /** True when nothing needs attention. */
  clean: boolean;
}

export interface AuditOptions {
  /** Sources every item is expected to have. Defaults to those present. */
  requiredSources?: SourceId[];
  /** Relative gap (0–1) above which sources are considered conflicting. */
  conflictThreshold?: number;
  /** Fold-change (e.g. 5 = 5×) beyond which a value move is "extreme". */
  extremeChangeFactor?: number;
  /** Reference time for future-timestamp checks. Defaults to now. */
  now?: Date;
  /** Records the importer could not map, surfaced for review. */
  unmappedRecords?: UnmappedRecord[];
  /**
   * Optional content hashes keyed by image path. When supplied, duplicate
   * images are detected by hash; otherwise identical image paths are grouped.
   */
  imageHashes?: Record<string, string>;
}

/** Image paths must be an http(s) URL or a relative path with a known extension. */
const IMAGE_PATH = /^(https?:\/\/\S+|[\w./-]+\.(png|jpe?g|webp|gif|svg))$/i;

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function relativeDisagreement(values: number[]): number {
  if (values.length < 2) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean === 0 ? 0 : (max - min) / mean;
}

function groupCollisions(pairs: Array<[string, string]>): DuplicateGroup[] {
  const byKey = new Map<string, Set<string>>();
  for (const [key, itemId] of pairs) {
    const set = byKey.get(key) ?? new Set<string>();
    set.add(itemId);
    byKey.set(key, set);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, ids] of byKey) {
    if (ids.size > 1) groups.push({ key, itemIds: [...ids].sort() });
  }
  return groups.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Run every audit check and return a single consolidated report. */
export function auditItems(items: Item[], options: AuditOptions = {}): AuditReport {
  const conflictThreshold = options.conflictThreshold ?? 0.15;
  const extremeChangeFactor = options.extremeChangeFactor ?? 5;
  const nowMs = (options.now ?? new Date()).getTime();

  const presentSources = new Set<SourceId>();
  for (const item of items) {
    for (const source of Object.keys(item.values) as SourceId[]) {
      presentSources.add(source);
    }
  }
  const requiredSources = options.requiredSources ?? [...presentSources];

  const nonCanonicalIds: string[] = [];
  const idCounts = new Map<string, number>();
  const namePairs: Array<[string, string]> = [];
  const aliasPairs: Array<[string, string]> = [];
  const missingBySource = Object.fromEntries(
    requiredSources.map((s) => [s, [] as string[]]),
  ) as Record<SourceId, string[]>;
  const sourceOnly: Array<{ itemId: string; source: SourceId }> = [];
  const conflicts: ConflictReport[] = [];
  const unverified: string[] = [];

  const impossibleValues: ReadingIssue[] = [];
  const extremeChanges: ExtremeChange[] = [];
  const futureTimestamps: ReadingIssue[] = [];
  const missingTimestamps: ReadingIssue[] = [];
  const missingImages: string[] = [];
  const brokenImagePaths: string[] = [];
  const imagePairs: Array<[string, string]> = [];

  // Group metadata by normalised name so same-named items can be checked for
  // conflicting category / rarity / type.
  const byName = new Map<
    string,
    { itemIds: string[]; categories: Set<string>; rarities: Set<string>; types: Set<string> }
  >();

  for (const item of items) {
    if (item.id !== slugify(item.displayName)) nonCanonicalIds.push(item.id);
    idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
    const name = normaliseName(item.displayName);
    namePairs.push([name, item.id]);
    for (const alias of item.aliases) {
      aliasPairs.push([normaliseName(alias), item.id]);
    }

    const group = byName.get(name) ?? {
      itemIds: [],
      categories: new Set<string>(),
      rarities: new Set<string>(),
      types: new Set<string>(),
    };
    group.itemIds.push(item.id);
    group.categories.add(item.category);
    group.rarities.add(item.rarity);
    group.types.add(item.chroma ? "chroma" : "standard");
    byName.set(name, group);

    if (item.verified === false) unverified.push(item.id);

    // Image checks.
    if (!item.image || item.image.trim() === "") {
      missingImages.push(item.id);
    } else {
      if (!IMAGE_PATH.test(item.image)) brokenImagePaths.push(item.id);
      const key = options.imageHashes?.[item.image] ?? item.image;
      imagePairs.push([key, item.id]);
    }

    const sources = Object.keys(item.values) as SourceId[];
    for (const required of requiredSources) {
      if (!item.values[required]) missingBySource[required].push(item.id);
    }
    if (sources.length === 1) {
      sourceOnly.push({ itemId: item.id, source: sources[0]! });
    }

    for (const source of sources) {
      const reading = item.values[source]!;

      // Impossible / negative values.
      if (!Number.isFinite(reading.value) || reading.value < 0) {
        impossibleValues.push({
          itemId: item.id,
          source,
          detail: `value ${reading.value}`,
        });
      }
      if (reading.previousValue !== undefined && reading.previousValue < 0) {
        impossibleValues.push({
          itemId: item.id,
          source,
          detail: `previousValue ${reading.previousValue}`,
        });
      }

      // Extreme value changes versus the previous value.
      const prev = reading.previousValue;
      if (prev !== undefined && prev > 0 && reading.value >= 0) {
        const ratio = reading.value / prev;
        if (ratio >= extremeChangeFactor || ratio <= 1 / extremeChangeFactor) {
          extremeChanges.push({
            itemId: item.id,
            source,
            from: prev,
            to: reading.value,
            changePercent: ((reading.value - prev) / prev) * 100,
          });
        }
      }

      // Timestamps: missing required, or in the future.
      const stamps: Array<[string, string | undefined]> = [
        ["updatedAt", reading.updatedAt],
        ["importedAt", reading.importedAt],
        ["retrievedAt", reading.retrievedAt],
      ];
      if (!reading.updatedAt || Number.isNaN(Date.parse(reading.updatedAt))) {
        missingTimestamps.push({ itemId: item.id, source, detail: "updatedAt" });
      }
      for (const [field, value] of stamps) {
        if (!value) continue;
        const t = Date.parse(value);
        if (!Number.isNaN(t) && t > nowMs) {
          futureTimestamps.push({ itemId: item.id, source, detail: field });
        }
      }
    }

    const readings = sources.map((source) => ({
      source,
      value: item.values[source]!.value,
    }));
    const disagreement = relativeDisagreement(readings.map((r) => r.value));
    if (disagreement > conflictThreshold) {
      conflicts.push({
        itemId: item.id,
        displayName: item.displayName,
        disagreement,
        readings,
      });
    }
  }

  // Field conflicts among same-named items.
  const conflictingCategories: FieldConflict[] = [];
  const conflictingRarities: FieldConflict[] = [];
  const conflictingTypes: FieldConflict[] = [];
  for (const [name, group] of byName) {
    if (group.itemIds.length < 2) continue;
    if (group.categories.size > 1) {
      conflictingCategories.push({ name, itemIds: [...group.itemIds].sort(), values: [...group.categories].sort() });
    }
    if (group.rarities.size > 1) {
      conflictingRarities.push({ name, itemIds: [...group.itemIds].sort(), values: [...group.rarities].sort() });
    }
    if (group.types.size > 1) {
      conflictingTypes.push({ name, itemIds: [...group.itemIds].sort(), values: [...group.types].sort() });
    }
  }
  const byNameKey = (a: FieldConflict, b: FieldConflict) => (a.name < b.name ? -1 : 1);
  conflictingCategories.sort(byNameKey);
  conflictingRarities.sort(byNameKey);
  conflictingTypes.sort(byNameKey);

  // An alias that exactly matches another item's canonical name is a conflict.
  for (const [name, itemId] of namePairs) aliasPairs.push([name, itemId]);

  const duplicateIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, itemIds: Array<string>(count).fill(key) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const duplicateNames = groupCollisions(namePairs);
  const duplicateAliases = groupCollisions(aliasPairs);
  const duplicateImages = groupCollisions(imagePairs);
  const unmappedRecords = [...(options.unmappedRecords ?? [])];

  const clean =
    nonCanonicalIds.length === 0 &&
    duplicateIds.length === 0 &&
    duplicateNames.length === 0 &&
    duplicateAliases.length === 0 &&
    conflictingCategories.length === 0 &&
    conflictingRarities.length === 0 &&
    conflictingTypes.length === 0 &&
    impossibleValues.length === 0 &&
    extremeChanges.length === 0 &&
    futureTimestamps.length === 0 &&
    missingTimestamps.length === 0 &&
    unmappedRecords.length === 0 &&
    brokenImagePaths.length === 0 &&
    duplicateImages.length === 0 &&
    Object.values(missingBySource).every((list) => list.length === 0) &&
    conflicts.length === 0 &&
    unverified.length === 0;

  return {
    itemCount: items.length,
    nonCanonicalIds: nonCanonicalIds.sort(),
    duplicateIds,
    duplicateNames,
    duplicateAliases,
    conflictingCategories,
    conflictingRarities,
    conflictingTypes,
    impossibleValues: impossibleValues.sort((a, b) => (a.itemId < b.itemId ? -1 : 1)),
    extremeChanges: extremeChanges.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)),
    futureTimestamps: futureTimestamps.sort((a, b) => (a.itemId < b.itemId ? -1 : 1)),
    missingTimestamps: missingTimestamps.sort((a, b) => (a.itemId < b.itemId ? -1 : 1)),
    unmappedRecords,
    missingImages: missingImages.sort(),
    brokenImagePaths: brokenImagePaths.sort(),
    duplicateImages,
    missingBySource,
    sourceOnly: sourceOnly.sort((a, b) => (a.itemId < b.itemId ? -1 : 1)),
    conflicts: conflicts.sort((a, b) => b.disagreement - a.disagreement),
    unverified: unverified.sort(),
    clean,
  };
}

/** Render an audit report as a short, human-readable plain-text summary. */
export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`Audited ${report.itemCount} items — ${report.clean ? "clean" : "issues found"}.`);
  if (report.nonCanonicalIds.length) {
    lines.push(`Non-canonical ids (${report.nonCanonicalIds.length}): ${report.nonCanonicalIds.join(", ")}`);
  }
  for (const group of report.duplicateIds) {
    lines.push(`Duplicate id "${group.key}": ${group.itemIds.join(", ")}`);
  }
  for (const group of report.duplicateNames) {
    lines.push(`Duplicate name "${group.key}": ${group.itemIds.join(", ")}`);
  }
  for (const group of report.duplicateAliases) {
    lines.push(`Duplicate alias "${group.key}": ${group.itemIds.join(", ")}`);
  }
  for (const c of report.conflictingCategories) {
    lines.push(`Category conflict "${c.name}": ${c.values.join(" vs ")} (${c.itemIds.join(", ")})`);
  }
  for (const c of report.conflictingRarities) {
    lines.push(`Rarity conflict "${c.name}": ${c.values.join(" vs ")} (${c.itemIds.join(", ")})`);
  }
  for (const c of report.conflictingTypes) {
    lines.push(`Type conflict "${c.name}": ${c.values.join(" vs ")} (${c.itemIds.join(", ")})`);
  }
  for (const issue of report.impossibleValues) {
    lines.push(`Impossible value ${issue.itemId}@${issue.source}: ${issue.detail}`);
  }
  for (const change of report.extremeChanges) {
    lines.push(
      `Extreme change ${change.itemId}@${change.source}: ${change.from} → ${change.to} ` +
        `(${change.changePercent.toFixed(0)}%)`,
    );
  }
  for (const issue of report.futureTimestamps) {
    lines.push(`Future timestamp ${issue.itemId}@${issue.source}: ${issue.detail}`);
  }
  for (const issue of report.missingTimestamps) {
    lines.push(`Missing timestamp ${issue.itemId}@${issue.source}: ${issue.detail}`);
  }
  if (report.unmappedRecords.length) {
    lines.push(`Unmapped source records: ${report.unmappedRecords.length}`);
  }
  if (report.missingImages.length) {
    lines.push(`Missing images (${report.missingImages.length}): ${report.missingImages.join(", ")}`);
  }
  if (report.brokenImagePaths.length) {
    lines.push(`Broken image paths (${report.brokenImagePaths.length}): ${report.brokenImagePaths.join(", ")}`);
  }
  for (const group of report.duplicateImages) {
    lines.push(`Duplicate image "${group.key}": ${group.itemIds.join(", ")}`);
  }
  for (const [source, list] of Object.entries(report.missingBySource)) {
    if (list.length) lines.push(`Missing ${source} value (${list.length}): ${list.join(", ")}`);
  }
  if (report.sourceOnly.length) {
    lines.push(
      `Single-source items (${report.sourceOnly.length}): ` +
        report.sourceOnly.map((s) => `${s.itemId}@${s.source}`).join(", "),
    );
  }
  for (const conflict of report.conflicts) {
    lines.push(
      `Conflict "${conflict.itemId}": ${(conflict.disagreement * 100).toFixed(1)}% ` +
        `(${conflict.readings.map((r) => `${r.source}=${r.value}`).join(", ")})`,
    );
  }
  if (report.unverified.length) {
    lines.push(`Unverified (${report.unverified.length}): ${report.unverified.join(", ")}`);
  }
  return lines.join("\n");
}

/** A flattened audit finding, suitable for CSV/JSON export. */
export interface AuditFinding {
  category: string;
  key: string;
  detail: string;
}

/** Flatten a report into one row per finding for export. */
export function auditFindings(report: AuditReport): AuditFinding[] {
  const rows: AuditFinding[] = [];
  const push = (category: string, key: string, detail = "") =>
    rows.push({ category, key, detail });

  for (const id of report.nonCanonicalIds) push("non-canonical-id", id);
  for (const g of report.duplicateIds) push("duplicate-id", g.key, g.itemIds.join(" "));
  for (const g of report.duplicateNames) push("duplicate-name", g.key, g.itemIds.join(" "));
  for (const g of report.duplicateAliases) push("duplicate-alias", g.key, g.itemIds.join(" "));
  for (const c of report.conflictingCategories)
    push("conflicting-category", c.name, `${c.values.join("|")} :: ${c.itemIds.join(" ")}`);
  for (const c of report.conflictingRarities)
    push("conflicting-rarity", c.name, `${c.values.join("|")} :: ${c.itemIds.join(" ")}`);
  for (const c of report.conflictingTypes)
    push("conflicting-type", c.name, `${c.values.join("|")} :: ${c.itemIds.join(" ")}`);
  for (const i of report.impossibleValues) push("impossible-value", `${i.itemId}@${i.source}`, i.detail);
  for (const c of report.extremeChanges)
    push("extreme-change", `${c.itemId}@${c.source}`, `${c.from} -> ${c.to} (${c.changePercent.toFixed(0)}%)`);
  for (const i of report.futureTimestamps) push("future-timestamp", `${i.itemId}@${i.source}`, i.detail);
  for (const i of report.missingTimestamps) push("missing-timestamp", `${i.itemId}@${i.source}`, i.detail);
  for (const u of report.unmappedRecords) push("unmapped-record", u.source, `${u.name ?? ""} :: ${u.reason}`);
  for (const id of report.missingImages) push("missing-image", id);
  for (const id of report.brokenImagePaths) push("broken-image-path", id);
  for (const g of report.duplicateImages) push("duplicate-image", g.key, g.itemIds.join(" "));
  for (const [source, list] of Object.entries(report.missingBySource))
    for (const id of list) push("missing-source-value", `${id}@${source}`);
  for (const s of report.sourceOnly) push("single-source", `${s.itemId}@${s.source}`);
  for (const c of report.conflicts)
    push("source-disagreement", c.itemId, `${(c.disagreement * 100).toFixed(1)}%`);
  for (const id of report.unverified) push("unverified", id);
  return rows;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Export the audit report as CSV (one finding per row). */
export function auditReportToCsv(report: AuditReport): string {
  const header = "category,key,detail";
  const rows = auditFindings(report).map(
    (f) => `${csvCell(f.category)},${csvCell(f.key)},${csvCell(f.detail)}`,
  );
  return [header, ...rows].join("\n");
}

/** Export the audit report as a stable, pretty-printed JSON string. */
export function auditReportToJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
