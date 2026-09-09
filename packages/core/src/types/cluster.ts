export type ClusterEdgeReason =
  | "common-funder"
  | "direct-transfer"
  | "repeated-co-buy"
  | "timing-correlation"
  | "shared-creator";

export interface ClusterEdge {
  a: string;
  b: string;
  reason: ClusterEdgeReason;
  weight: number; // 0..1
}

export interface ClusterFlags {
  concentratedOwnership: boolean;
  coordinatedBuying: boolean;
  immediateLargeSelling: boolean;
  creatorAssociatedWallets: boolean;
  suspiciousLiquidityBehavior: boolean;
}

export interface WalletCluster {
  clusterId: string;
  members: string[];
  edges: ClusterEdge[];
  tokenMint?: string;
  flags: ClusterFlags;
  manipulationPenalty: number; // 0..100, feeds into signal engine
  computedAt: number;
}
