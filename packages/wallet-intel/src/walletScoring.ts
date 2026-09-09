import type { StrategyConfig, WalletScoreBreakdown, WalletStats } from "@whale-sniper/core";

// Bayesian shrinkage prior: "3 wins out of 6 trades" (50%), i.e. a mildly
// skeptical neutral prior. A wallet with very few trades gets pulled hard
// toward this prior; a wallet with hundreds of trades barely moves off its
// raw win rate. This is what stops an 8-trade/75%-win wallet from
// outscoring a 200-trade/64%-win wallet on win rate alone.
const SHRINKAGE_PRIOR_WINS = 3;
const SHRINKAGE_PRIOR_TRADES = 6;
// Trade count at which sample-size confidence saturates to 1.0.
const CONFIDENCE_SATURATION_TRADES = 30;
const TARGET_EARLY_ENTRY_FREQUENCY = 0.6;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function shrunkWinRate(stats: WalletStats): number {
  return (stats.winCount + SHRINKAGE_PRIOR_WINS) / (stats.tradeCount + SHRINKAGE_PRIOR_TRADES);
}

function sampleConfidence(stats: WalletStats): number {
  return clamp01(stats.tradeCount / CONFIDENCE_SATURATION_TRADES);
}

export function consistencyScore(stats: WalletStats): number {
  const shrunk = shrunkWinRate(stats);
  const confidence = sampleConfidence(stats);
  // Confidence discounts the shrunk rate further: a thin sample can still
  // look decent after shrinkage but shouldn't score as high as a proven one.
  return shrunk * 100 * (0.5 + 0.5 * confidence);
}

export function timingScore(stats: WalletStats): number {
  return clamp01(stats.earlyEntryFrequency / TARGET_EARLY_ENTRY_FREQUENCY) * 100;
}

export function selectivityScore(stats: WalletStats, config: StrategyConfig): number {
  const conviction = stats.avgWhaleBuySizeUsd / (3 * config.walletGate.minWhaleBuySizeUsd);
  return clamp01(conviction) * 100;
}

export function exitQualityScore(stats: WalletStats): number {
  const roiComponent = clamp01(stats.avgRoiPct / 80) * 70;
  const drawdownComponent = clamp01((100 - stats.maxDrawdownPct) / 100) * 30;
  return roiComponent + drawdownComponent;
}

export function rugAvoidanceScore(stats: WalletStats): number {
  return Math.max(0, 100 - stats.rugExposureCount * 25);
}

export function recentPerformanceScore(stats: WalletStats): number {
  return clamp01(stats.realizedPnlUsd / 50000) * 100;
}

export function scoreWallet(stats: WalletStats, config: StrategyConfig): WalletScoreBreakdown {
  const w = config.walletScoreWeights;
  const consistency = consistencyScore(stats);
  const timing = timingScore(stats);
  const selectivity = selectivityScore(stats, config);
  const exitQuality = exitQualityScore(stats);
  const rugAvoidance = rugAvoidanceScore(stats);
  const recentPerformance = recentPerformanceScore(stats);

  const whaleScore =
    w.consistency * consistency +
    w.timing * timing +
    w.selectivity * selectivity +
    w.exitQuality * exitQuality +
    w.rugAvoidance * rugAvoidance +
    w.recentPerformance * recentPerformance;

  const gateFailureReasons = evaluateHardGate(stats, whaleScore, config);

  return {
    wallet: stats.wallet,
    consistency,
    timing,
    selectivity,
    exitQuality,
    rugAvoidance,
    recentPerformance,
    whaleScore,
    passedHardGate: gateFailureReasons.length === 0,
    gateFailureReasons,
    computedAt: Date.now(),
  };
}

function evaluateHardGate(stats: WalletStats, whaleScore: number, config: StrategyConfig): string[] {
  const g = config.walletGate;
  const reasons: string[] = [];
  if (stats.tradeCount < g.minTradeCount) reasons.push(`tradeCount ${stats.tradeCount} < ${g.minTradeCount}`);
  if (stats.winRate < g.minWinRate) reasons.push(`winRate ${stats.winRate.toFixed(2)} < ${g.minWinRate}`);
  if (stats.realizedPnlUsd < g.minRealizedPnlUsd) {
    reasons.push(`realizedPnlUsd ${stats.realizedPnlUsd.toFixed(0)} < ${g.minRealizedPnlUsd}`);
  }
  if (stats.avgRoiPct < g.minAvgRoiPct) reasons.push(`avgRoiPct ${stats.avgRoiPct.toFixed(1)} < ${g.minAvgRoiPct}`);
  if (stats.avgWhaleBuySizeUsd < g.minWhaleBuySizeUsd) {
    reasons.push(`avgWhaleBuySizeUsd ${stats.avgWhaleBuySizeUsd.toFixed(0)} < ${g.minWhaleBuySizeUsd}`);
  }
  if (stats.maxDrawdownPct > g.maxDrawdownPct) {
    reasons.push(`maxDrawdownPct ${stats.maxDrawdownPct.toFixed(1)} > ${g.maxDrawdownPct}`);
  }
  if (stats.earlyEntryFrequency < g.minEarlyEntryFrequency) {
    reasons.push(`earlyEntryFrequency ${stats.earlyEntryFrequency.toFixed(2)} < ${g.minEarlyEntryFrequency}`);
  }
  if (stats.rugExposureCount > g.maxRugExposureCount) {
    reasons.push(`rugExposureCount ${stats.rugExposureCount} > ${g.maxRugExposureCount}`);
  }
  if (whaleScore < g.minWhaleScore) reasons.push(`whaleScore ${whaleScore.toFixed(1)} < ${g.minWhaleScore}`);
  return reasons;
}
