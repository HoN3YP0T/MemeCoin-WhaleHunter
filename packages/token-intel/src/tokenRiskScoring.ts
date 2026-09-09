import { riskBand, type StrategyConfig, type TokenRiskScore, type TokenStats } from "@whale-sniper/core";

const MATURE_AGE_SECONDS = 24 * 60 * 60;
const TARGET_LIQUIDITY_USD = 100_000;
const TARGET_UNIQUE_BUYERS_1H = 20;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function ageRiskComponent(stats: TokenStats, atUnixSeconds: number): number {
  const ageSeconds = Math.max(0, atUnixSeconds - stats.createdAt);
  return clamp01(1 - ageSeconds / MATURE_AGE_SECONDS);
}

export function liquidityRiskComponent(stats: TokenStats): number {
  return clamp01(1 - stats.liquidityUsd / TARGET_LIQUIDITY_USD);
}

export function concentrationRiskComponent(stats: TokenStats): number {
  return clamp01(stats.top10HolderPct);
}

export function authorityRiskComponent(stats: TokenStats): number {
  const mintRisk = stats.mintAuthorityRevoked ? 0 : 0.5;
  const freezeRisk = stats.freezeAuthorityRevoked ? 0 : 0.5;
  return mintRisk + freezeRisk;
}

export function buyerDiversityRiskComponent(stats: TokenStats): number {
  return clamp01(1 - stats.uniqueBuyers1h / TARGET_UNIQUE_BUYERS_1H);
}

export function flowRiskComponent(stats: TokenStats): number {
  const total = stats.buyVolumeUsd5m + stats.sellVolumeUsd5m;
  if (total <= 0) return 0;
  return clamp01(stats.sellVolumeUsd5m / total);
}

export function scoreTokenRisk(stats: TokenStats, config: StrategyConfig, atUnixSeconds: number): TokenRiskScore {
  const w = config.tokenRiskWeights;
  const ageRisk = ageRiskComponent(stats, atUnixSeconds);
  const liquidityRisk = liquidityRiskComponent(stats);
  const concentrationRisk = concentrationRiskComponent(stats);
  const authorityRisk = authorityRiskComponent(stats);
  const buyerDiversityRisk = buyerDiversityRiskComponent(stats);
  const flowRisk = flowRiskComponent(stats);

  const riskScore =
    100 *
    (w.ageRisk * ageRisk +
      w.liquidityRisk * liquidityRisk +
      w.concentrationRisk * concentrationRisk +
      w.authorityRisk * authorityRisk +
      w.buyerDiversityRisk * buyerDiversityRisk +
      w.flowRisk * flowRisk);

  return {
    tokenMint: stats.tokenMint,
    ageRisk,
    liquidityRisk,
    concentrationRisk,
    authorityRisk,
    buyerDiversityRisk,
    flowRisk,
    riskScore,
    band: riskBand(riskScore),
    computedAt: Date.now(),
  };
}
