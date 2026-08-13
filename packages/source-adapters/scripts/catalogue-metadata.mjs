// @ts-check

/** Turn an item name into the stable slug format used by the catalogue. */
export function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strip the value suffix that appears on some chroma rows. */
export function cleanName(name) {
  return name.replace(/\s*Value:\s*[\d,]+\s*$/i, "").trim();
}

function readable(value) {
  if (!value) return "";
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed URL is still usable as plain metadata.
  }
  return decoded
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function hasWord(text, words) {
  const padded = ` ${text} `;
  return words.some((word) => padded.includes(` ${word} `));
}

const GUN_WORDS = [
  "gun",
  "revolver",
  "blaster",
  "beam",
  "cannon",
  "rifle",
  "luger",
  "raygun",
  "shot",
  "shark",
  "scope",
  "harvester",
  "icepiercer",
  "minty",
  "sugar",
  "darkbringer",
  "lightbringer",
  "amerilaser",
  "laser",
  "america",
  "cowboy",
  "golden",
  "phaser",
];

const KNIFE_WORDS = [
  "knife",
  "blade",
  "axe",
  "scythe",
  "sword",
  "dagger",
  "chopper",
  "breaker",
  "crusher",
  "edge",
  "deathshard",
  "batwing",
  "boneblade",
  "gingerblade",
  "candleflame",
  "clockwork",
  "handsaw",
  "gemstone",
  "fang",
  "seer",
  "tides",
];

/** Infer broad inventory type from licensed metadata, preferring wiki metadata. */
export function inferCategory({ sourceCategory, displayName, wikiUrl, imageUrl }) {
  const source = String(sourceCategory ?? "").trim().toLowerCase();
  if (source === "pets" || source === "pet") return "pet";

  const wiki = readable(wikiUrl);
  if (hasWord(wiki, ["pet"])) return "pet";
  if (hasWord(wiki, ["gun", "revolver", "blaster", "rifle"])) return "gun";
  if (hasWord(wiki, ["knife", "blade", "axe", "scythe", "sword", "dagger"])) return "knife";

  const combined = readable(`${displayName ?? ""} ${imageUrl ?? ""}`);
  if (hasWord(combined, ["pet"])) return "pet";
  if (hasWord(combined, GUN_WORDS)) return "gun";
  if (hasWord(combined, KNIFE_WORDS)) return "knife";
  if (source === "misc" && hasWord(combined, ["set", "bundle", "pack"])) return "bundle";
  if (
    [
      "common",
      "uncommon",
      "rare",
      "legendary",
      "godly",
      "ancient",
      "unique",
      "vintage",
      "chroma",
    ].includes(source)
  ) {
    // MM2Values' rarity lists contain weapons. Items without an explicit gun
    // marker are knives; pet and miscellaneous lists were handled above.
    return "knife";
  }
  return "other";
}

function fullYear(text, maximumYear) {
  for (const match of text.matchAll(/(?:^|\D)(20\d{2})(?:\D|$)/g)) {
    const year = Number(match[1]);
    if (year >= 2014 && year <= maximumYear) return year;
  }
  return undefined;
}

/** Infer release year from explicit wiki or licensed image metadata. */
export function inferYear({ displayName, wikiUrl, imageUrl }, maximumYear = new Date().getUTCFullYear() + 1) {
  for (const value of [wikiUrl, displayName, imageUrl]) {
    const text = readable(value);
    const year = fullYear(text, maximumYear);
    if (year) return year;
  }

  const filename = String(imageUrl ?? "")
    .split(/[/?#]/)
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  const short = filename.match(/(?:^|[^0-9])(1[4-9]|2[0-9])(?:up|updated)?$/i);
  if (short) {
    const year = 2000 + Number(short[1]);
    if (year <= maximumYear) return year;
  }
  return undefined;
}

/** Add category/year metadata to one licensed export row. */
export function deriveCatalogueMetadata(row) {
  const displayName = cleanName(String(row.displayName ?? row.name ?? ""));
  return {
    displayName,
    category: inferCategory({
      sourceCategory: row.sourceCategory ?? row.category,
      displayName,
      wikiUrl: row.wikiUrl,
      imageUrl: row.imageUrl,
    }),
    year: inferYear({ displayName, wikiUrl: row.wikiUrl, imageUrl: row.imageUrl }),
  };
}

const LABELS = {
  knife: "Knife",
  gun: "Gun",
  pet: "Pet",
  bundle: "Bundle",
  other: "",
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
  godly: "Godly",
  ancient: "Ancient",
  unique: "Unique",
  vintage: "Vintage",
  chroma: "Chroma",
  misc: "Misc",
};

function typeAlreadyInName(name, category) {
  const text = readable(name);
  if (category === "gun") return hasWord(text, ["gun", "revolver", "blaster", "rifle"]);
  if (category === "knife") return hasWord(text, ["knife", "blade", "axe", "scythe", "sword", "dagger"]);
  return category === "pet" && hasWord(text, ["pet"]);
}

function descriptor(row, includeRarity, includeSourceId) {
  const parts = [];
  if (row.category !== "other" && !typeAlreadyInName(row.displayName, row.category)) {
    parts.push(LABELS[row.category] ?? row.category);
  }
  if (row.year) parts.push(String(row.year));
  if (includeRarity || parts.length === 0) parts.push(LABELS[row.rarity] ?? row.rarity);
  if (includeSourceId) parts.push(`MM2Values #${row.sourceItemId ?? "unknown"}`);
  return parts;
}

/**
 * Give same-named catalogue rows deterministic, human-readable labels without
 * changing their stable ids. Category and year are preferred; rarity and the
 * source id are deterministic fallbacks when the source metadata is sparse.
 */
export function disambiguateCatalogueRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.displayName.trim().toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
    row.catalogueName = row.displayName;
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const states = group.map((row) => ({ row, rarity: false, source: false }));

    const collide = () => {
      const byLabel = new Map();
      for (const state of states) {
        const label = descriptor(state.row, state.rarity, state.source).join(", ").toLowerCase();
        const bucket = byLabel.get(label) ?? [];
        bucket.push(state);
        byLabel.set(label, bucket);
      }
      return [...byLabel.values()].filter((bucket) => bucket.length > 1);
    };

    for (const bucket of collide()) for (const state of bucket) state.rarity = true;
    for (const bucket of collide()) for (const state of bucket) state.source = true;

    for (const state of states) {
      const parts = descriptor(state.row, state.rarity, state.source);
      state.row.catalogueName = `${state.row.displayName} (${parts.join(", ")})`;
    }
  }

  const names = rows.map((row) => row.catalogueName.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new Error("Catalogue disambiguation did not produce unique display names");
  }
  return rows;
}
