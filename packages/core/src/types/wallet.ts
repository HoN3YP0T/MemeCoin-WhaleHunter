export interface WalletTradeRecord {
  txSignature: string;
  tokenMint: string;
  side: "BUY" | "SELL";
  usdValue: number;
  priceUsd: number;
  blockTime: number;
  /** ROI realized on the round-trip this trade closes, if it closes one. */
  realizedRoiPct?: number;
  /** True if the token this trade touched went on to be flagged a rug. */
  wasRug?: boolean;
  /** How early relative to the token's life this buy landed, 0..1 (0 = at launch). */
  entryPercentile?: number;
}

/** Incrementally maintained, as-of-timestamp wallet statistics. */
export interface WalletStats {
  wallet: string;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  realizedPnlUsd: number;
  avgRoiPct: number;
  maxDrawdownPct: number;
  avgWhaleBuySizeUsd: number;
  earlyEntryFrequency: number; // fraction of buys within the "early" window
  rugExposureCount: number;
  lastTradeAt: number;
  firstTradeAt: number;
}

export interface WalletScoreBreakdown {
  wallet: string;
  consistency: number;
  timing: number;
  selectivity: number;
  exitQuality: number;
  rugAvoidance: number;
  recentPerformance: number;
  whaleScore: number;
  passedHardGate: boolean;
  gateFailureReasons: string[];
  computedAt: number;
}
