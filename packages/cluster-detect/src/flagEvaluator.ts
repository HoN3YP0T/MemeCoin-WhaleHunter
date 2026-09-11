import type { ClusterFlags, NormalizedTradeEvent, TokenStats, WalletCluster } from "@whale-sniper/core";
import type { WalletRelationshipSource } from "./walletRelationshipSource.js";

const IMMEDIATE_SELL_WINDOW_SECONDS = 30;
const IMMEDIATE_SELL_FRACTION = 0.5;
const FLAG_PENALTY_POINTS = 20;

export interface FlagEvaluationInput {
  cluster: WalletCluster;
  tokenMint: string;
  trades: NormalizedTradeEvent[]; // all trades observed for this token
  tokenStats: TokenStats | undefined;
  /** Only `isCreatorAssociated` is read here, so any object with that
   * method satisfies it - including a full `WalletRelationshipSource`. */
  relationshipSource: Pick<WalletRelationshipSource, "isCreatorAssociated">;
  tokenIsRugged: boolean;
  manipulationPenaltyCap: number;
}

export function evaluateClusterFlags(input: FlagEvaluationInput): { flags: ClusterFlags; manipulationPenalty: number } {
  const { cluster, tokenMint, trades, tokenStats, relationshipSource, tokenIsRugged, manipulationPenaltyCap } = input;
  const memberSet = new Set(cluster.members);

  const totalBuyVolume = trades.filter((t) => t.side === "BUY").reduce((s, t) => s + t.usdValue, 0);
  const clusterBuyVolume = trades
    .filter((t) => t.side === "BUY" && memberSet.has(t.wallet))
    .reduce((s, t) => s + t.usdValue, 0);
  const clusterVolumeShare = totalBuyVolume > 0 ? clusterBuyVolume / totalBuyVolume : 0;

  const concentratedOwnership = clusterVolumeShare > 0.5 || (tokenStats?.top10HolderPct ?? 0) > 0.7;

  const timingEdgeCount = cluster.edges.filter((e) => e.reason === "timing-correlation").length;
  const coordinatedBuying = timingEdgeCount >= 2 || cluster.edges.some((e) => e.reason === "common-funder");

  const immediateLargeSelling = detectImmediateLargeSelling(trades, memberSet);

  const creatorAssociatedWallets = cluster.members.some((w) => relationshipSource.isCreatorAssociated(tokenMint, w));

  const flags: ClusterFlags = {
    concentratedOwnership,
    coordinatedBuying,
    immediateLargeSelling,
    creatorAssociatedWallets,
    suspiciousLiquidityBehavior: tokenIsRugged,
  };

  const trueFlagCount = Object.values(flags).filter(Boolean).length;
  const manipulationPenalty = Math.min(manipulationPenaltyCap, trueFlagCount * FLAG_PENALTY_POINTS);

  return { flags, manipulationPenalty };
}

function detectImmediateLargeSelling(trades: NormalizedTradeEvent[], memberSet: Set<string>): boolean {
  const byWallet = new Map<string, NormalizedTradeEvent[]>();
  for (const t of trades) {
    if (!memberSet.has(t.wallet)) continue;
    const arr = byWallet.get(t.wallet) ?? [];
    arr.push(t);
    byWallet.set(t.wallet, arr);
  }

  for (const walletTrades of byWallet.values()) {
    const sorted = [...walletTrades].sort((a, b) => a.blockTime - b.blockTime);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].side !== "BUY") continue;
      const boughtAmount = sorted[i].tokenAmount;
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].blockTime - sorted[i].blockTime > IMMEDIATE_SELL_WINDOW_SECONDS) break;
        if (sorted[j].side === "SELL" && sorted[j].tokenAmount >= boughtAmount * IMMEDIATE_SELL_FRACTION) {
          return true;
        }
      }
    }
  }
  return false;
}
