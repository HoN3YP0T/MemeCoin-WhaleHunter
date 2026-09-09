export interface TokenMetadataSeed {
  liquidityUsd: number;
  marketCapUsd: number;
  holderCount: number;
  top10HolderPct: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
}

/**
 * Provider-agnostic source for the pieces of `TokenStats` that can't be
 * derived from the trade stream itself (liquidity, market cap, holder
 * concentration, mint/freeze authority state) - see `TokenStatsCollector`'s
 * class comment for why the rest of TokenStats comes from the stream
 * directly. `MockTokenMetadataProvider` and `DexScreenerTokenMetadataProvider`
 * both implement this, so `TokenStatsCollector` never needs to know which
 * one is behind it - the same DI pattern `IFeedProvider`/`IExecutionAdapter`
 * use elsewhere in this codebase.
 */
export interface ITokenMetadataProvider {
  get(tokenMint: string): TokenMetadataSeed;
}
