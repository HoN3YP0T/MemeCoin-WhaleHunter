export interface TokenStats {
  tokenMint: string;
  createdAt: number; // unix seconds
  liquidityUsd: number;
  marketCapUsd: number;
  holderCount: number;
  top10HolderPct: number; // 0..1 concentration of top 10 holders
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  /** Wallet that deployed this token's mint, when known (currently only
   * populated by SolscanTokenMetadataProvider). See
   * `TokenMetadataSeed.creatorAddress` for the full rationale. */
  creatorAddress?: string;
  /** How many tokens this creator has previously launched, per Solscan.
   * Undefined (neutral, not risky) when unknown - see
   * `TokenMetadataSeed.creatorTokenLaunchCount`. */
  creatorTokenLaunchCount?: number;
  uniqueBuyers1h: number;
  uniqueSellers1h: number;
  buyVolumeUsd5m: number;
  sellVolumeUsd5m: number;
  buyVolumeUsd1h: number;
  sellVolumeUsd1h: number;
  updatedAt: number;
}

export interface TokenRiskScore {
  tokenMint: string;
  ageRisk: number;
  liquidityRisk: number;
  concentrationRisk: number;
  authorityRisk: number;
  buyerDiversityRisk: number;
  flowRisk: number;
  /** Blends the self-learned creator rug rate (CreatorRegistry) with
   * Solscan's serial-deployer signal (creatorTokenLaunchCount). Always
   * computed and visible, but contributes 0 to riskScore while
   * tokenRiskWeights.creatorRisk stays 0 (the shipped default) - see
   * `creatorRiskComponent` in tokenRiskScoring.ts. */
  creatorRisk: number;
  riskScore: number; // 0-100, higher = riskier
  band: "very-low" | "low" | "moderate" | "high" | "extreme";
  computedAt: number;
}

export function riskBand(score: number): TokenRiskScore["band"] {
  if (score <= 20) return "very-low";
  if (score <= 40) return "low";
  if (score <= 60) return "moderate";
  if (score <= 80) return "high";
  return "extreme";
}
