export interface TokenStats {
  tokenMint: string;
  createdAt: number; // unix seconds
  liquidityUsd: number;
  marketCapUsd: number;
  holderCount: number;
  top10HolderPct: number; // 0..1 concentration of top 10 holders
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
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
