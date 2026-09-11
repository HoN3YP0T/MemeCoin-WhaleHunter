import type { EventBus, NormalizedTradeEvent, RuggedTokenRegistry, StrategyConfig, WalletCluster } from "@whale-sniper/core";
import type { IClusterRepository, ITokenRepository } from "@whale-sniper/db";
import { buildClusters } from "./clusterGraph.js";
import { repeatedCoBuyEdges, timingCorrelationEdges } from "./edgeDetectors.js";
import { evaluateClusterFlags } from "./flagEvaluator.js";
import type { WalletRelationshipSource } from "./walletRelationshipSource.js";

/** Buffers trades per token from the live stream and, on demand (called at
 * the signal engine's cluster-check stage), builds the wallet relationship
 * graph for that token and merges it into clusters with manipulation
 * flags. */
export class ClusterDetector {
  private tradesByToken = new Map<string, NormalizedTradeEvent[]>();

  constructor(
    private readonly bus: EventBus,
    private readonly clusterRepo: IClusterRepository,
    private readonly tokenRepo: ITokenRepository,
    private readonly relationshipSource: WalletRelationshipSource,
    private readonly ruggedRegistry: RuggedTokenRegistry,
    private readonly config: StrategyConfig,
  ) {}

  start(): () => void {
    return this.bus.on("trade.normalized", (event) => {
      const arr = this.tradesByToken.get(event.tokenMint) ?? [];
      arr.push(event);
      this.tradesByToken.set(event.tokenMint, arr);
    });
  }

  async detectForToken(tokenMint: string): Promise<WalletCluster[]> {
    const trades = this.tradesByToken.get(tokenMint) ?? [];
    if (trades.length === 0) return [];

    const wallets = [...new Set(trades.map((t) => t.wallet))];
    const edges = [
      ...timingCorrelationEdges(trades),
      ...repeatedCoBuyEdges(this.buildCoBuyGrouping(wallets, tokenMint)),
      ...this.relationshipSource.commonFunderEdges(wallets),
      ...this.relationshipSource.sharedCreatorEdges(tokenMint, wallets),
    ];

    const clusters = buildClusters(edges, this.config.clusterThresholds.edgeMergeThreshold, tokenMint);
    const tokenStats = await this.tokenRepo.getStats(tokenMint);

    const evaluated: WalletCluster[] = [];
    for (const cluster of clusters) {
      const { flags, manipulationPenalty } = evaluateClusterFlags({
        cluster,
        tokenMint,
        trades,
        tokenStats,
        relationshipSource: this.relationshipSource,
        tokenIsRugged: this.ruggedRegistry.isRugged(tokenMint),
        manipulationPenaltyCap: this.config.clusterThresholds.manipulationPenaltyCap,
      });
      const full: WalletCluster = { ...cluster, flags, manipulationPenalty };
      evaluated.push(full);
      await this.clusterRepo.upsertCluster(full);
      this.bus.emit("cluster.detected", { clusterId: full.clusterId, members: full.members });
    }
    return evaluated;
  }

  /** Only this token's trades are on hand for repeated-co-buy detection in
   * the live path (cross-token history lives in wallet-intel); this keeps
   * the detector self-contained while still catching same-token repeat
   * patterns (e.g. re-entries) as a lighter-weight signal. */
  private buildCoBuyGrouping(_wallets: string[], tokenMint: string): Map<string, NormalizedTradeEvent[]> {
    return new Map([[tokenMint, this.tradesByToken.get(tokenMint) ?? []]]);
  }
}
