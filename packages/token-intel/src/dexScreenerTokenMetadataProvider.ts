import { conservativeUnknownSeed, FetchTokenDataHttpClient, type ITokenMetadataProvider, type TokenDataHttpClient, type TokenMetadataSeed } from "./tokenMetadataProvider.js";

// Re-exported so existing call sites/tests that import these two names from
// this file (rather than the shared tokenMetadataProvider.ts) keep working
// unchanged.
export { FetchTokenDataHttpClient, type TokenDataHttpClient };

/** DexScreener's public token-pairs lookup - no API key required. See
 * https://docs.dexscreener.com/api/reference (GET /latest/dex/tokens/:address). */
const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens/";

// DexScreener's public API is rate-limited (documented as ~300 req/min
// across all their token-profile endpoints combined); a real sniper can
// look up the same fresh token many times in a few seconds as trades roll
// in, so cache aggressively short-term rather than hitting the API on
// every call.
const DEFAULT_CACHE_TTL_MS = 20_000;

// Shape of the fields this adapter actually reads out of DexScreener's
// response, per the public docs - deliberately loose/partial (`Partial`,
// optional-everywhere) since DexScreener's schema is not versioned/typed
// anywhere we can import from, and pairs for illiquid/very new tokens
// routinely omit fields like marketCap or fdv.
interface DexScreenerPair {
  chainId?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number; // ms epoch
}

interface DexScreenerTokensResponse {
  pairs?: DexScreenerPair[] | null;
}

// DexScreener cannot provide holder count/top-10 concentration/authority
// state/creator identity at all - `conservativeUnknownSeed()` (shared with
// `SolscanTokenMetadataProvider` so the fallback semantics never drift
// between adapters) is always used for those fields. See its doc comment in
// tokenMetadataProvider.ts for why missing data reads as risky, not safe.

function pickBestPair(pairs: DexScreenerPair[]): DexScreenerPair | undefined {
  const solanaPairs = pairs.filter((p) => p.chainId === undefined || p.chainId === "solana");
  const candidates = solanaPairs.length > 0 ? solanaPairs : pairs;
  return candidates.reduce<DexScreenerPair | undefined>((best, p) => {
    const liq = p.liquidity?.usd ?? 0;
    const bestLiq = best?.liquidity?.usd ?? -1;
    return liq > bestLiq ? p : best;
  }, undefined);
}

function mapResponseToSeed(raw: unknown): TokenMetadataSeed {
  const response = raw as DexScreenerTokensResponse;
  const pairs = response.pairs ?? [];
  const pair = pairs.length > 0 ? pickBestPair(pairs) : undefined;
  if (!pair) return conservativeUnknownSeed();

  const fallback = conservativeUnknownSeed();
  return {
    liquidityUsd: pair.liquidity?.usd ?? fallback.liquidityUsd,
    marketCapUsd: pair.marketCap ?? pair.fdv ?? fallback.marketCapUsd,
    // DexScreener has no holder/concentration/authority data at all (see
    // conservativeUnknownSeed's comment) - always the conservative fallback,
    // never guessed from price/volume.
    holderCount: fallback.holderCount,
    top10HolderPct: fallback.top10HolderPct,
    mintAuthorityRevoked: fallback.mintAuthorityRevoked,
    freezeAuthorityRevoked: fallback.freezeAuthorityRevoked,
  };
}

interface CacheEntry {
  seed: TokenMetadataSeed;
  fetchedAt: number;
}

/**
 * Real `ITokenMetadataProvider` backed by DexScreener's free, no-API-key
 * token endpoint. `TokenStatsCollector` calls `get()` synchronously on
 * every trade, so this can't simply `await` a fetch inline - instead it
 * returns the last cached value (or a conservative "unknown" seed before
 * the first successful fetch completes) and kicks off a short-TTL,
 * de-duplicated background refresh. A slightly stale liquidity/market-cap
 * figure is an acceptable trade for never blocking the hot trade path on
 * network I/O; a failed fetch just leaves the previous cache entry (or the
 * conservative fallback) in place rather than throwing.
 */
export class DexScreenerTokenMetadataProvider implements ITokenMetadataProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly http: TokenDataHttpClient = new FetchTokenDataHttpClient(),
    private readonly cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

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

  private triggerRefresh(tokenMint: string): void {
    if (this.inFlight.has(tokenMint)) return;
    const p = this.refreshNow(tokenMint).finally(() => this.inFlight.delete(tokenMint));
    this.inFlight.set(tokenMint, p);
  }

  private async refreshNow(tokenMint: string): Promise<void> {
    try {
      const raw = await this.http.fetchJson(`${DEXSCREENER_TOKENS_URL}${tokenMint}`);
      const seed = mapResponseToSeed(raw);
      this.cache.set(tokenMint, { seed, fetchedAt: this.now() });
    } catch {
      // Leave the existing cache entry (if any) in place - a transient
      // DexScreener/network failure shouldn't wipe out the last known-good
      // reading, and get() already has a conservative fallback for the
      // never-successfully-fetched case.
    }
  }
}
