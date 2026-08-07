import type { SourceId } from "@tradelens/item-schema";
import type { RawRow } from "./index.js";

/**
 * Provider abstraction for value sources.
 *
 * Every trusted source (Supreme Values, MM2Values, …) is wrapped in a provider
 * that exposes a single `fetchRows` method returning already-normalised
 * {@link RawRow}s. Keeping fetching behind this interface means the rest of the
 * pipeline never depends on a source's private response shape, and unpermitted
 * access patterns (arbitrary scraping) have no place to hook in.
 *
 * IMPORTANT — source availability (investigated 2026-07-31):
 * Neither supremevalues.com nor mm2values.com publishes an official or
 * documented API, data export, or partner feed. MM2Values is a manually
 * curated PHP site; Supreme Values is a client-rendered SPA. The built-in
 * Supreme/MM2Values providers below are therefore *inert templates*: they only
 * do anything when pointed at a feed the source owner has explicitly agreed to
 * provide, and their field mappings are assumptions to confirm with that owner
 * — not a reflection of any existing public endpoint. Until such permission
 * exists, use the manual-entry path (rows flagged `verified: false`).
 */
export interface ProviderContext {
  /**
   * Perform an HTTP request on the provider's behalf. Injected so providers are
   * pure and testable, and so a single place can enforce timeouts, auth and
   * allow-listing of hosts.
   */
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
  /** When the fetch is happening (ISO 8601); defaults to now at call time. */
  now?: () => string;
}

/** A single, permitted value source. */
export interface Provider {
  /** Canonical source id used throughout the schema. */
  readonly id: SourceId;
  /** Human-readable source name. */
  readonly displayName: string;
  /** Semantic version of this adapter, recorded on every reading. */
  readonly adapterVersion: string;
  /**
   * How this provider is permitted to obtain data. Providers must only be
   * created for sources TradeLens has explicit permission to use.
   */
  readonly permission: PermissionBasis;
  /** Fetch and normalise the source's current rows. */
  fetchRows(ctx: ProviderContext): Promise<RawRow[]>;
}

/**
 * The legal/ethical basis on which a provider is allowed to be used. There is
 * deliberately no "scrape" option — unauthorised scraping is out of scope.
 */
export type PermissionBasis =
  | "official-api"
  | "partner-agreement"
  | "licensed-export"
  | "explicit-permission";

/** Options shared by the built-in HTTP-backed providers. */
export interface HttpProviderOptions {
  /** Base URL of the permitted endpoint (HTTPS in production). */
  baseUrl: string;
  /** Optional bearer token for authenticated partner/API access. */
  token?: string;
}

/** Guard: refuse to construct a provider without a permission basis. */
function assertPermitted(id: SourceId, basis: PermissionBasis | undefined): PermissionBasis {
  if (!basis) {
    throw new Error(
      `Refusing to create provider "${id}" without a stated permission basis. ` +
        `TradeLens only integrates sources it is permitted to use.`,
    );
  }
  return basis;
}

/**
 * Build an authorization header set when a token is present. Kept tiny and
 * explicit so credentials never leak into logs elsewhere.
 */
function authHeaders(token?: string): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Supreme Values provider (template — requires explicit permission).
 *
 * No official Supreme Values API exists as of 2026-07-31. This adapter is only
 * usable against an endpoint the site owner has agreed to expose; the
 * {@link SupremeResponse} shape below is an *assumed* mapping target to be
 * confirmed with them, not a documented contract. Constructing this provider
 * asserts you hold a valid {@link PermissionBasis}.
 */
export function createSupremeProvider(
  options: HttpProviderOptions,
  permission: PermissionBasis = "explicit-permission",
): Provider {
  const basis = assertPermitted("supreme", permission);
  const adapterVersion = "supreme-1.0.0";
  return {
    id: "supreme",
    displayName: "Supreme Values",
    adapterVersion,
    permission: basis,
    async fetchRows(ctx) {
      const now = ctx.now?.() ?? new Date().toISOString();
      const body = (await ctx.fetchJson(`${options.baseUrl}/items`, {
        headers: { accept: "application/json", ...authHeaders(options.token) },
      })) as SupremeResponse;
      return (body.items ?? []).map((raw) => mapSupremeRow(raw, now));
    },
  };
}

/**
 * MM2Values provider (template — requires explicit permission).
 *
 * No official MM2Values API exists as of 2026-07-31; the site is manually
 * curated. As above, this adapter only activates against a feed the owner
 * agrees to provide, and {@link Mm2ValuesResponse} is an assumed mapping
 * target to confirm with them — not a documented endpoint.
 */
export function createMm2ValuesProvider(
  options: HttpProviderOptions,
  permission: PermissionBasis = "explicit-permission",
): Provider {
  const basis = assertPermitted("mm2values", permission);
  const adapterVersion = "mm2values-1.0.0";
  return {
    id: "mm2values",
    displayName: "MM2Values",
    adapterVersion,
    permission: basis,
    async fetchRows(ctx) {
      const now = ctx.now?.() ?? new Date().toISOString();
      const body = (await ctx.fetchJson(`${options.baseUrl}/values`, {
        headers: { accept: "application/json", ...authHeaders(options.token) },
      })) as Mm2ValuesResponse;
      return (body.data ?? []).map((raw) => mapMm2ValuesRow(raw, now));
    },
  };
}

/**
 * Assumed shape of a permitted Supreme Values feed. Placeholder field names to
 * be confirmed if/when the owner provides real access — no such public API
 * exists today.
 */
interface SupremeResponse {
  items?: SupremeRow[];
}
interface SupremeRow {
  id?: string;
  name: string;
  aliases?: string[];
  type: string;
  rarity: string;
  origin?: string;
  year?: number;
  chroma?: boolean;
  value: number;
  demand?: number;
  trend?: number;
  previous?: number;
  updated_at: string;
}

/**
 * Assumed shape of a permitted MM2Values feed. Placeholder field names to be
 * confirmed if/when the owner provides real access — no such public API exists
 * today.
 */
interface Mm2ValuesResponse {
  data?: Mm2ValuesRow[];
}
interface Mm2ValuesRow {
  slug?: string;
  title: string;
  altNames?: string[];
  category: string;
  rarity: string;
  set?: string;
  releaseYear?: number;
  isChroma?: boolean;
  price: number;
  demandScore?: number;
  updatedAt: string;
}

const CATEGORY_MAP: Record<string, RawRow["category"]> = {
  knife: "knife",
  knives: "knife",
  gun: "gun",
  guns: "gun",
  pet: "pet",
  pets: "pet",
  bundle: "bundle",
  set: "bundle",
};

function mapCategory(value: string): RawRow["category"] {
  return CATEGORY_MAP[value.toLowerCase()] ?? "other";
}

const RARITY_VALUES = new Set([
  "common",
  "uncommon",
  "rare",
  "legendary",
  "godly",
  "ancient",
  "unique",
  "vintage",
  "chroma",
]);

function mapRarity(value: string): RawRow["rarity"] {
  const v = value.toLowerCase();
  return (RARITY_VALUES.has(v) ? v : "common") as RawRow["rarity"];
}

function mapSupremeRow(raw: SupremeRow, retrievedAt: string): RawRow {
  return {
    name: raw.name,
    aliases: raw.aliases,
    category: mapCategory(raw.type),
    rarity: mapRarity(raw.rarity),
    origin: raw.origin,
    year: raw.year,
    chroma: raw.chroma,
    value: raw.value,
    demand: raw.demand,
    trendPercent: raw.trend,
    previousValue: raw.previous,
    updatedAt: raw.updated_at,
    sourceItemId: raw.id,
    retrievedAt,
    extractionMethod: "api",
    verified: true,
  };
}

function mapMm2ValuesRow(raw: Mm2ValuesRow, retrievedAt: string): RawRow {
  return {
    name: raw.title,
    aliases: raw.altNames,
    category: mapCategory(raw.category),
    rarity: mapRarity(raw.rarity),
    origin: raw.set,
    year: raw.releaseYear,
    chroma: raw.isChroma,
    value: raw.price,
    demand: raw.demandScore,
    updatedAt: raw.updatedAt,
    sourceItemId: raw.slug,
    retrievedAt,
    extractionMethod: "api",
    verified: true,
  };
}
