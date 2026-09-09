import {
  conservativeUnknownSeed,
  FetchTokenDataHttpClient,
  type ITokenMetadataProvider,
  type TokenDataHttpClient,
  type TokenMetadataSeed,
} from "./tokenMetadataProvider.js";

/**
 * ---------------------------------------------------------------------
 * HONESTY NOTE (matching the standard `HeliusFeedProvider`/pumpFunDecoder.ts
 * set for their own unverified judgment calls): this adapter is written
 * against Solscan's documented Pro API v2.0 shape as described in their
 * public docs (https://pro-api.solscan.io, https://docs.solscan.io), but
 * this build has no live `SOLSCAN_API_KEY` to test against. Endpoint paths,
 * exact response field names, and the account-activity approach used for
 * `creatorTokenLaunchCount` below are BEST-EFFORT and UNVERIFIED - if you
 * have a live key, verify against Solscan's current docs before relying on
 * this in production, and expect to adjust `SolscanTokenMetaResponse`/
 * `SolscanTokenHoldersResponse`/`SolscanAccountActivitiesResponse` and the
 * three URL builders below to match. Every mapping function here is
 * defensive (loose/partial types, try/catch around each fetch) specifically
 * because of that uncertainty - a shape mismatch degrades to the same
 * conservative fallback `DexScreenerTokenMetadataProvider` uses, it never
 * throws into the hot trade path.
 * ---------------------------------------------------------------------
 */

const SOLSCAN_BASE_URL = "https://pro-api.solscan.io/v2.0";
/** GET /token/meta?address=<mint> - token metadata incl. supply, price,
 * mint/freeze authority, holder count, and (per Solscan's docs for
 * pump.fun-launched tokens specifically) a `creator` address. */
const TOKEN_META_PATH = "/token/meta";
/** GET /token/holders?address=<mint>&page=1&page_size=10 - top holders,
 * used for top-10 concentration. */
const TOKEN_HOLDERS_PATH = "/token/holders";
/** GET /account/defi/activities?address=<creator>&activity_type[]=<...> -
 * a creator wallet's on-chain activity history. There is no single
 * documented Solscan endpoint that directly answers "how many tokens has
 * this wallet created" as of this writing, so this adapter approximates it
 * by counting token-creation-shaped activities for the creator address
 * returned by /token/meta. The `ACTIVITY_TYPE` used below is a best guess
 * at Solscan's naming convention for that activity, not confirmed against
 * a live response - see the class comment.
 */
const ACCOUNT_ACTIVITIES_PATH = "/account/defi/activities";
const CREATOR_ACTIVITY_TYPE = "ACTIVITY_TOKEN_CREATE";
const HOLDERS_PAGE_SIZE = 10;

// Solscan's Pro API is a paid, rate-limited product; a real sniper can look
// up the same fresh token many times in a few seconds as trades roll in, so
// cache aggressively short-term rather than spending API quota on every
// call - same TTL DexScreener's adapter uses, for the same reason.
const DEFAULT_CACHE_TTL_MS = 20_000;

// --- Response shapes (loose/partial - see HONESTY NOTE above) ---

interface SolscanTokenMetaResponse {
  success?: boolean;
  data?: {
    address?: string;
    creator?: string;
    supply?: string;
    price?: number;
    marketCap?: number;
    market_cap?: number;
    holder?: number;
    holderCount?: number;
    mintAuthority?: string | null;
    mint_authority?: string | null;
    freezeAuthority?: string | null;
    freeze_authority?: string | null;
  };
}

interface SolscanHolderItem {
  address?: string;
  owner?: string;
  amount?: string;
  percentage?: number; // 0-100, when Solscan supplies it directly
  rank?: number;
}

interface SolscanTokenHoldersResponse {
  success?: boolean;
  data?: {
    total?: number;
    items?: SolscanHolderItem[];
  };
}

interface SolscanAccountActivitiesResponse {
  success?: boolean;
  data?: unknown[];
  total?: number;
}

function tokenMetaUrl(mint: string): string {
  return `${SOLSCAN_BASE_URL}${TOKEN_META_PATH}?address=${encodeURIComponent(mint)}`;
}

function tokenHoldersUrl(mint: string): string {
  return `${SOLSCAN_BASE_URL}${TOKEN_HOLDERS_PATH}?address=${encodeURIComponent(mint)}&page=1&page_size=${HOLDERS_PAGE_SIZE}`;
}

function creatorActivitiesUrl(creatorAddress: string): string {
  return `${SOLSCAN_BASE_URL}${ACCOUNT_ACTIVITIES_PATH}?address=${encodeURIComponent(creatorAddress)}&activity_type[]=${CREATOR_ACTIVITY_TYPE}&page=1&page_size=1`;
}

// An explicit `null` means Solscan itself reports the authority as
// renounced. A missing/absent field (undefined - unknown response shape, or
// the field genuinely omitted) must NOT be read as revoked - that would be
// the "safe" misread the conservative-fallback policy exists to avoid. Only
// a confirmed null counts.
function mintAuthorityRevokedFrom(meta: SolscanTokenMetaResponse["data"]): boolean {
  const mint = meta?.mintAuthority !== undefined ? meta.mintAuthority : meta?.mint_authority;
  return mint === null;
}

function freezeAuthorityRevokedFrom(meta: SolscanTokenMetaResponse["data"]): boolean {
  const freeze = meta?.freezeAuthority !== undefined ? meta.freezeAuthority : meta?.freeze_authority;
  return freeze === null;
}

function top10HolderPctFrom(holders: SolscanTokenHoldersResponse): number | undefined {
  const items = holders.data?.items;
  if (!items || items.length === 0) return undefined;
  // Prefer Solscan's own `percentage` field when present (0-100, per-holder
  // share of supply) - summing the top 10 gives concentration directly
  // without needing to also parse `supply`'s decimals correctly.
  const withPct = items.filter((h) => typeof h.percentage === "number");
  if (withPct.length === 0) return undefined;
  const top10 = withPct.slice(0, 10);
  const sum = top10.reduce((s, h) => s + (h.percentage ?? 0), 0);
  return Math.max(0, Math.min(1, sum / 100));
}

function holderCountFrom(meta: SolscanTokenMetaResponse["data"], holders: SolscanTokenHoldersResponse): number | undefined {
  return meta?.holder ?? meta?.holderCount ?? holders.data?.total;
}

function creatorLaunchCountFrom(activities: SolscanAccountActivitiesResponse): number | undefined {
  // Prefer an explicit `total` count of matching activities (a list
  // endpoint returning the count of items matching the filter, independent
  // of the single-item page requested) over counting the returned page,
  // since we only request page_size=1 to save quota.
  if (typeof activities.total === "number") return activities.total;
  if (Array.isArray(activities.data)) return activities.data.length;
  return undefined;
}

interface CacheEntry {
  seed: TokenMetadataSeed;
  fetchedAt: number;
}

/**
 * Real `ITokenMetadataProvider` backed by Solscan's Pro API v2.0. Mirrors
 * `DexScreenerTokenMetadataProvider` exactly in shape: a synchronous,
 * non-blocking `get()` backed by a short-TTL, de-duplicated background
 * cache refresh, so `TokenStatsCollector`'s hot trade-stream path never
 * blocks on network I/O. Unlike DexScreener, Solscan can supply all six
 * `TokenMetadataSeed` fields (see the HONESTY NOTE above for how confident
 * to be in the exact field mapping) plus `creatorAddress`/
 * `creatorTokenLaunchCount`, which DexScreener cannot supply at all.
 *
 * Requires a Pro-API key (https://pro-api.solscan.io) - the constructor
 * throws on an empty key rather than silently making unauthenticated
 * requests that would just fail per-call, mirroring `HeliusFeedProvider`'s
 * "defense in depth" fail-fast (the composition root in wiring.ts is
 * responsible for refusing to select this provider at all when
 * `SOLSCAN_API_KEY` is unset).
 */
export class SolscanTokenMetadataProvider implements ITokenMetadataProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly apiKey: string,
    private readonly http: TokenDataHttpClient = new FetchTokenDataHttpClient(),
    private readonly cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (!apiKey) {
      throw new Error("SolscanTokenMetadataProvider requires a non-empty apiKey (SOLSCAN_API_KEY)");
    }
  }

  get(tokenMint: string): TokenMetadataSeed {
    const cached = this.cache.get(tokenMint);
    const stale = !cached || this.now() - cached.fetchedAt > this.cacheTtlMs;
    if (stale) this.triggerRefresh(tokenMint);
    return cached?.seed ?? conservativeUnknownSeed();
  }

  /** Exposed for callers (or tests) that want to await a first real fetch
   * instead of accepting the conservative fallback on a cold cache. Not
   * used by `TokenStatsCollector` itself, which only ever calls `get()`. */
  async prefetch(tokenMint: string): Promise<void> {
    await this.refreshNow(tokenMint);
  }

  private authHeaders(): Record<string, string> {
    // Solscan's Pro API documents a `token` header carrying the API key.
    return { token: this.apiKey };
  }

  private triggerRefresh(tokenMint: string): void {
    if (this.inFlight.has(tokenMint)) return;
    const p = this.refreshNow(tokenMint).finally(() => this.inFlight.delete(tokenMint));
    this.inFlight.set(tokenMint, p);
  }

  private async fetchJsonSafe(url: string): Promise<unknown | undefined> {
    try {
      return await this.http.fetchJson(url, this.authHeaders());
    } catch {
      return undefined;
    }
  }

  private async refreshNow(tokenMint: string): Promise<void> {
    const metaRaw = await this.fetchJsonSafe(tokenMetaUrl(tokenMint));
    if (metaRaw === undefined) {
      // The one call that actually matters (liquidity/market-cap-adjacent
      // fields, authority state, creator address) failed - leave the
      // existing cache entry (if any) in place rather than overwriting a
      // known-good reading with a conservative one, same policy
      // DexScreener's adapter follows.
      return;
    }

    const meta = (metaRaw as SolscanTokenMetaResponse).data;
    const holdersRaw = await this.fetchJsonSafe(tokenHoldersUrl(tokenMint));
    const holders = (holdersRaw as SolscanTokenHoldersResponse | undefined) ?? {};

    const creatorAddress = meta?.creator;
    let creatorTokenLaunchCount: number | undefined;
    if (creatorAddress) {
      const activitiesRaw = await this.fetchJsonSafe(creatorActivitiesUrl(creatorAddress));
      if (activitiesRaw !== undefined) {
        creatorTokenLaunchCount = creatorLaunchCountFrom(activitiesRaw as SolscanAccountActivitiesResponse);
      }
      // A failed/unparseable activity lookup leaves creatorTokenLaunchCount
      // undefined - neutral, not risky, per TokenMetadataSeed's field
      // comment. It does NOT block caching the rest of this refresh.
    }

    const fallback = conservativeUnknownSeed();
    const seed: TokenMetadataSeed = {
      // Solscan's token/meta doesn't carry a DEX liquidity-pool figure the
      // way DexScreener does (that's a pool-level, not mint-level,
      // concept) - liquidity/market-cap here fall back to the conservative
      // "unknown" default unless a future response shape adds them.
      // marketCap, when present, is still worth reading.
      liquidityUsd: fallback.liquidityUsd,
      marketCapUsd: meta?.marketCap ?? meta?.market_cap ?? fallback.marketCapUsd,
      holderCount: holderCountFrom(meta, holders) ?? fallback.holderCount,
      top10HolderPct: top10HolderPctFrom(holders) ?? fallback.top10HolderPct,
      mintAuthorityRevoked: mintAuthorityRevokedFrom(meta),
      freezeAuthorityRevoked: freezeAuthorityRevokedFrom(meta),
      creatorAddress,
      creatorTokenLaunchCount,
    };

    this.cache.set(tokenMint, { seed, fetchedAt: this.now() });
  }
}
