import type { EntryGateResult, Signal, StrategyConfig, TokenRiskScore, TokenStats, WalletCluster, WalletScoreBreakdown } from "@whale-sniper/core";

export interface EntryGateInputs {
  walletScore: WalletScoreBreakdown;
  tokenRisk: TokenRiskScore;
  tokenStats: TokenStats;
  signal: Signal;
  cluster?: WalletCluster;
  estimatedSlippagePct: number;
  riskEngineVeto?: { vetoed: boolean; reason?: string };
}

/**
 * Hard AND across every independent safeguard - implements "never trade on
 * a single whale buy blindly". Every condition is checked (not short-
 * circuited) so a caller/test can see every reason a trade was blocked,
 * not just the first.
 */
export function evaluateEntryGate(input: EntryGateInputs, config: StrategyConfig): EntryGateResult {
  const reasons: string[] = [];
  const g = config.entryGate;
  const t = config.tokenThresholds;

  if (!input.walletScore.passedHardGate) {
    reasons.push(`whale not qualified: ${input.walletScore.gateFailureReasons.join("; ") || "hard gate failed"}`);
  }

  if (input.tokenRisk.riskScore > t.maxTokenRiskScore) {
    reasons.push(`token risk ${input.tokenRisk.riskScore.toFixed(1)} > max ${t.maxTokenRiskScore}`);
  }

  if (input.tokenStats.liquidityUsd < t.minLiquidityUsd) {
    reasons.push(`liquidity ${input.tokenStats.liquidityUsd.toFixed(0)} < min ${t.minLiquidityUsd}`);
  }

  if (input.cluster) {
    const activeFlags = Object.entries(input.cluster.flags).filter(([, v]) => v).map(([k]) => k);
    if (activeFlags.length > 0) {
      reasons.push(`active manipulation flags: ${activeFlags.join(", ")}`);
    }
  }

  if (input.tokenStats.uniqueBuyers1h < g.minIndependentBuyers) {
    reasons.push(`independent buyers ${input.tokenStats.uniqueBuyers1h} < min ${g.minIndependentBuyers}`);
  }

  if (input.tokenStats.buyVolumeUsd5m < g.minBuyingMomentumUsd5m) {
    reasons.push(`buying momentum $${input.tokenStats.buyVolumeUsd5m.toFixed(0)} < min $${g.minBuyingMomentumUsd5m}`);
  }

  if (input.estimatedSlippagePct > g.maxSlippagePct) {
    reasons.push(`estimated slippage ${input.estimatedSlippagePct.toFixed(2)}% > max ${g.maxSlippagePct}%`);
  }

  if (input.signal.score < g.minSignalScore) {
    reasons.push(`signal score ${input.signal.score.toFixed(1)} < min ${g.minSignalScore}`);
  }

  if (input.riskEngineVeto?.vetoed) {
    reasons.push(`risk engine veto: ${input.riskEngineVeto.reason ?? "unspecified"}`);
  }

  return { passed: reasons.length === 0, reasons };
}
