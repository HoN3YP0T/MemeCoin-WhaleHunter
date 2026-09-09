export interface TokenMetadataSeed {
  liquidityUsd: number;
  marketCapUsd: number;
  holderCount: number;
  top10HolderPct: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  /**
   * Wallet that created/deployed this token's mint, when the provider can
   * attribute one (currently only `SolscanTokenMetadataProvider` - neither
   * the mock provider nor DexScreener has creator-identity data at all).
   * Undefined, not a guessed address, when unknown.
   */
  creatorAddress?: string;
  /**
   * How many tokens this creator has previously launched, per Solscan's
   * account-activity history - a serial-deployer signal fed into
   * `creatorRiskComponent`. Deliberately optional and, when absent, must be
   * treated as *neutral* (zero risk contribution) rather than risky: a
   * brand-new first-time creator is completely normal, and a Solscan
   * outage or a provider that doesn't support this field (mock,
   * DexScreener) shouldn't punish every token equally the way the other
   * four fields' conservative-risky fallback does. See
   * `creatorRiskComponent` in tokenRiskScoring.ts.
   */
  creatorTokenLaunchCount?: number;
}

/**
 * Provider-agnostic source for the pieces of `TokenStats` that can't be
 * derived from the trade stream itself (liquidity, market cap, holder
 * concentration, mint/freeze authority state, creator identity) - see
 * `TokenStatsCollector`'s class comment for why the rest of TokenStats
 * comes from the stream directly. `MockTokenMetadataProvider`,
 * `DexScreenerTokenMetadataProvider`, and `SolscanTokenMetadataProvider`
 * all implement this, so `TokenStatsCollector` never needs to know which
 * one is behind it - the same DI pattern `IFeedProvider`/`IExecutionAdapter`
 * use elsewhere in this codebase.
 */
export interface ITokenMetadataProvider {
  get(tokenMint: string): TokenMetadataSeed;
}

const DEFAULT_HTTP_TIMEOUT_MS = 5_000;

/**
 * Narrow HTTP seam shared by every real `ITokenMetadataProvider` adapter, so
 * tests never make a real network call. `headers` is optional so
 * DexScreener's existing (unauthenticated) call sites don't need to change
 * at all, while Solscan's Pro-API adapter can pass its `token` auth header
 * through the same interface. Default implementation uses Node 22's
 * built-in global `fetch`.
 */
export interface TokenDataHttpClient {
  fetchJson(url: string, headers?: Record<string, string>): Promise<unknown>;
}

export class FetchTokenDataHttpClient implements TokenDataHttpClient {
  constructor(private readonly timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS) {}

  async fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", ...headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`token data request failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Conservative fallback for the fields a live token-data provider might not
 * be able to supply at all (DexScreener never supplies holder
 * count/concentration/authority state; Solscan falls back here too on a
 * malformed/missing response). A live risk-scoring fallback must not
 * coin-flip whether a rug vector looks "safe" the way
 * `MockTokenMetadataProvider`'s pseudo-random flags can for deterministic
 * test scenarios - authority-revoked is a security signal, and missing data
 * has to read as risky, not safe. Concretely: both authorities default to
 * *not revoked* (the risky end of `authorityRiskComponent`), and holder
 * count/concentration default to worst-case-plausible values rather than a
 * comfortable mid-range guess. `creatorAddress`/`creatorTokenLaunchCount`
 * are deliberately left undefined here (not defaulted to some risky
 * sentinel) - see the field comments on `TokenMetadataSeed` for why unknown
 * creator data must read as neutral, not risky.
 */
export function conservativeUnknownSeed(): TokenMetadataSeed {
  return {
    liquidityUsd: 0,
    marketCapUsd: 0,
    holderCount: 0,
    top10HolderPct: 1,
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
  };
}
