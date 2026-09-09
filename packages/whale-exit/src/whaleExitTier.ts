import type { PositionWhaleState, StrategyConfig } from "@whale-sniper/core";

export type WhaleExitTier = PositionWhaleState["tier"];

export interface IndependentFlags {
  multipleExits: boolean; // whale has sold across 3+ separate transactions
  coordinatedClusterSelling: boolean; // wallets clustered with the whale are also dumping
  liquidityDeteriorating: boolean; // pool liquidity has dropped meaningfully since entry
  volumeReversal: boolean; // sell volume now dominates buy volume by the configured ratio
}

export interface TierEvaluationInput {
  cumulativeSoldFraction: number;
  flags: IndependentFlags;
}

export interface TierEvaluationResult {
  tier: WhaleExitTier;
  reasons: string[];
}

/**
 * Tiered response to a triggering whale selling out of a position we're
 * still holding. The raw sold-percentage thresholds are the primary
 * driver, but any independent red flag can escalate the tier even when the
 * whale's own sold fraction hasn't crossed the next threshold yet - the
 * whale isn't the only tell that something is going wrong.
 */
export function evaluateWhaleExitTier(input: TierEvaluationInput, config: StrategyConfig["whaleExit"]): TierEvaluationResult {
  const reasons: string[] = [];
  let tier: WhaleExitTier = "NONE";

  const escalate = (candidate: WhaleExitTier, reason: string) => {
    if (rank(candidate) > rank(tier)) tier = candidate;
    reasons.push(reason);
  };

  if (input.cumulativeSoldFraction >= config.emergencyThresholdPct) {
    escalate("EMERGENCY", `whale sold ${(input.cumulativeSoldFraction * 100).toFixed(0)}% >= emergency threshold`);
  } else if (input.cumulativeSoldFraction >= config.reduceThresholdPct) {
    escalate("REDUCE", `whale sold ${(input.cumulativeSoldFraction * 100).toFixed(0)}% >= reduce threshold`);
  } else if (input.cumulativeSoldFraction >= config.warnThresholdPct) {
    escalate("WARN", `whale sold ${(input.cumulativeSoldFraction * 100).toFixed(0)}% >= warn threshold`);
  }

  if (input.flags.multipleExits) escalate("REDUCE", "whale has sold across multiple separate transactions");
  if (input.flags.coordinatedClusterSelling) escalate("EMERGENCY", "cluster-linked wallets are selling in coordination");
  if (input.flags.liquidityDeteriorating) escalate("REDUCE", "pool liquidity has deteriorated since entry");
  if (input.flags.volumeReversal) escalate("REDUCE", "sell volume now dominates buy volume");

  return { tier, reasons };
}

function rank(tier: WhaleExitTier): number {
  switch (tier) {
    case "EMERGENCY":
      return 3;
    case "REDUCE":
      return 2;
    case "WARN":
      return 1;
    default:
      return 0;
  }
}
