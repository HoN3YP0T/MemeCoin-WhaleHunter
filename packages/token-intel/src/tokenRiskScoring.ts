import { riskBand, type CreatorReputation, type StrategyConfig, type TokenRiskScore, type TokenStats } from "@whale-sniper/core";

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

// Serial-deployer signal saturates around 10 prior launches: a first-time
// creator (creatorTokenLaunchCount === 1) contributes 0, ramping linearly
// to 1 at 10 launches. Undefined (unknown - mock/DexScreener, or Solscan
// hasn't resolved a creator yet) also contributes 0 - see the field comment
// on `TokenMetadataSeed.creatorTokenLaunchCount` for why "unknown" must
// read as neutral here, unlike the other four token-metadata fields'
// conservative-risky fallback.
const SERIAL_DEPLOYER_SATURATION_LAUNCHES = 10;
// Confidence-shrinkage saturation point for the self-learned rug rate,
// mirroring walletScoring.ts's sampleConfidence() pattern (there:
// CONFIDENCE_SATURATION_TRADES = 30 trades) - here a creator's rug rate is
// only trusted at full weight once we've personally observed 5 of their
// tokens; a 1-token sample (rugged or not) barely moves creatorRisk.
const CREATOR_RUG_RATE_CONFIDENCE_SATURATION = 5;

/**
 * Blends two independent creator-identity risk signals into one 0-1 value:
 *
 * 1. Solscan's `creatorTokenLaunchCount` (serial-deployer signal) - a
 *    creator who has launched many tokens before is more likely running a
 *    farm than a single legitimate project.
 * 2. This bot's own self-learned rug rate for that creator
 *    (`CreatorReputation.tokensRugged / tokensCreated`, built purely from
 *    `RuggedTokenRegistry`'s existing, unmodified liquidity-crash
 *    detection via `CreatorRegistryUpdater`), confidence-shrunk by how many
 *    of that creator's tokens we've actually observed - the same idea
 *    `walletScoring.ts`'s Bayesian/confidence shrinkage uses to stop a
 *    thin sample from dominating a score.
 *
 * Returns exactly 0 when there is no data at all (no `creatorReputation`
 * and no `stats.creatorTokenLaunchCount`) - this must never contribute risk
 * out of thin air, since `tokenRiskWeights.creatorRisk` ships at 0 and an
 * operator turning it on for the first time should see it react to real
 * signal, not synthesize risk for tokens Solscan/CreatorRegistry simply
 * haven't covered yet.
 */
export function creatorRiskComponent(stats: TokenStats, creatorReputation?: CreatorReputation): number {
  const launchCount = stats.creatorTokenLaunchCount;
  const serialDeployerSignal =
    launchCount === undefined ? 0 : clamp01((launchCount - 1) / SERIAL_DEPLOYER_SATURATION_LAUNCHES);

  const tokensCreated = creatorReputation?.tokensCreated ?? 0;
  const tokensRugged = creatorReputation?.tokensRugged ?? 0;
  const rawRugRate = tokensCreated > 0 ? tokensRugged / tokensCreated : 0;
  const confidence = clamp01(tokensCreated / CREATOR_RUG_RATE_CONFIDENCE_SATURATION);
  const shrunkRugRate = rawRugRate * confidence;

  return clamp01(0.5 * serialDeployerSignal + 0.5 * shrunkRugRate);
}

export function scoreTokenRisk(
  stats: TokenStats,
  config: StrategyConfig,
  atUnixSeconds: number,
  creatorReputation?: CreatorReputation,
): TokenRiskScore {
  const w = config.tokenRiskWeights;
  const ageRisk = ageRiskComponent(stats, atUnixSeconds);
  const liquidityRisk = liquidityRiskComponent(stats);
  const concentrationRisk = concentrationRiskComponent(stats);
  const authorityRisk = authorityRiskComponent(stats);
  const buyerDiversityRisk = buyerDiversityRiskComponent(stats);
  const flowRisk = flowRiskComponent(stats);
  const creatorRisk = creatorRiskComponent(stats, creatorReputation);

  const riskScore =
    100 *
    (w.ageRisk * ageRisk +
      w.liquidityRisk * liquidityRisk +
      w.concentrationRisk * concentrationRisk +
      w.authorityRisk * authorityRisk +
      w.buyerDiversityRisk * buyerDiversityRisk +
      w.flowRisk * flowRisk +
      w.creatorRisk * creatorRisk);

  return {
    tokenMint: stats.tokenMint,
    ageRisk,
    liquidityRisk,
    concentrationRisk,
    authorityRisk,
    buyerDiversityRisk,
    flowRisk,
    creatorRisk,
    riskScore,
    band: riskBand(riskScore),
    computedAt: Date.now(),
  };
}
