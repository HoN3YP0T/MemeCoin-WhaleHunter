import { newId, type ClusterEdge, type WalletCluster } from "@whale-sniper/core";
import { UnionFind } from "./unionFind.js";

/**
 * Merges a weighted-edge wallet relationship graph into clusters via
 * union-find: any edge at or above `mergeThreshold` joins its two wallets
 * into the same cluster. Wallets connected only by sub-threshold edges (or
 * not connected at all) stay in separate singleton/unmerged groups and are
 * dropped from the result - a cluster is only meaningful with 2+ members.
 */
export function buildClusters(
  edges: ClusterEdge[],
  mergeThreshold: number,
  tokenMint?: string,
): WalletCluster[] {
  const uf = new UnionFind();
  const strongEdges = edges.filter((e) => e.weight >= mergeThreshold);

  for (const edge of strongEdges) {
    uf.union(edge.a, edge.b);
  }
  // Make sure every wallet mentioned by *any* edge participates in a group,
  // even ones only connected by sub-threshold edges (they'll just end up
  // as singletons and get filtered out below).
  for (const edge of edges) {
    uf.find(edge.a);
    uf.find(edge.b);
  }

  const groups = uf.groups();
  const clusters: WalletCluster[] = [];

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const memberSet = new Set(members);
    const clusterEdges = edges.filter((e) => memberSet.has(e.a) && memberSet.has(e.b));
    clusters.push({
      clusterId: newId("cluster"),
      members: [...members].sort(),
      edges: clusterEdges,
      tokenMint,
      flags: {
        concentratedOwnership: false,
        coordinatedBuying: false,
        immediateLargeSelling: false,
        creatorAssociatedWallets: false,
        suspiciousLiquidityBehavior: false,
      },
      manipulationPenalty: 0,
      computedAt: Date.now(),
    });
  }

  return clusters;
}
