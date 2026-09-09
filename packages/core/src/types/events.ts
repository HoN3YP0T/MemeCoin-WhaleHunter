export type TradeSide = "BUY" | "SELL";

export type DexName =
  | "raydium"
  | "orca"
  | "pumpfun"
  | "meteora"
  | "jupiter"
  | "unknown";

/** Raw, provider-shaped event as it comes off a feed (mock or real). */
export interface RawFeedEvent {
  provider: string;
  txSignature: string;
  slot: number;
  blockTime: number; // unix seconds
  raw: unknown;
  receivedAt: number; // ms epoch, when our process observed it
}

/**
 * Every stage a trade event passes through on its way from the wire to a
 * Telegram notification. Populated incrementally as the event moves through
 * the pipeline; every field is a ms-epoch timestamp or undefined until that
 * stage runs. Stages 0-2 (raw -> decoded -> walletMatched) are the
 * allocation-light hot path; everything from tokenLookup onward is the
 * "intelligence" path and only runs for whale BUYs from watchlisted wallets.
 */
export interface EventTimestamps {
  rawReceivedAt: number;
  decodedAt?: number;
  walletMatchedAt?: number;
  tokenLookupAt?: number;
  clusterCheckAt?: number;
  scoredAt?: number;
  signalAt?: number;
  riskCheckedAt?: number;
  orderBuiltAt?: number;
  filledAt?: number;
  confirmedAt?: number;
  notifiedAt?: number;
}

export interface NormalizedTradeEvent {
  id: string;
  wallet: string;
  tokenMint: string;
  side: TradeSide;
  tokenAmount: number;
  usdValue: number;
  priceUsd: number;
  dex: DexName;
  pool: string;
  slot: number;
  blockTime: number;
  txSignature: string;
  timestamps: EventTimestamps;
}

/** Domain events published on the shared event bus. */
export interface DomainEventMap {
  "trade.normalized": NormalizedTradeEvent;
  "whale.detected": { wallet: string; tokenMint: string; usdValue: number; whaleScore: number };
  "wallet.stats-updated": { wallet: string };
  "wallet.scored": { wallet: string; score: number };
  "token.stats-updated": { tokenMint: string };
  "cluster.detected": { clusterId: string; members: string[] };
  "signal.generated": { signalId: string; tokenMint: string; score: number };
  "signal.rejected": { tokenMint: string; reason: string };
  "position.opened": { positionId: string; tokenMint: string };
  "position.updated": { positionId: string };
  "position.closed": { positionId: string; reason: string };
  "whale.exit-detected": { wallet: string; tokenMint: string; pctSold: number };
  "feed.error": { provider: string; message: string };
  "feed.health": { provider: string; healthy: boolean };
}

export type DomainEventName = keyof DomainEventMap;
