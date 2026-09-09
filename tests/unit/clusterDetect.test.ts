import type { ClusterEdge, NormalizedTradeEvent } from "@whale-sniper/core";
import { buildClusters, evaluateClusterFlags, MockWalletRelationshipSource, timingCorrelationEdges } from "@whale-sniper/cluster-detect";
import { describe, expect, it } from "vitest";

function edge(a: string, b: string, weight: number, reason: ClusterEdge["reason"] = "common-funder"): ClusterEdge {
  return { a, b, reason, weight };
}

describe("buildClusters (union-find merge)", () => {
  it("merges a synthetic cluster of wallets connected by strong edges", () => {
    const edges: ClusterEdge[] = [
      edge("A", "B", 0.9),
      edge("B", "C", 0.95),
      edge("X", "Y", 0.9),
    ];
    const clusters = buildClusters(edges, 0.5);
    expect(clusters).toHaveLength(2);
    const abc = clusters.find((c) => c.members.includes("A"))!;
    expect(new Set(abc.members)).toEqual(new Set(["A", "B", "C"]));
    const xy = clusters.find((c) => c.members.includes("X"))!;
    expect(new Set(xy.members)).toEqual(new Set(["X", "Y"]));
  });

  it("does not merge wallets only connected by sub-threshold edges", () => {
    const edges: ClusterEdge[] = [edge("A", "B", 0.2)];
    const clusters = buildClusters(edges, 0.5);
    expect(clusters).toHaveLength(0);
  });

  it("leaves unrelated wallets in separate clusters", () => {
    const edges: ClusterEdge[] = [edge("A", "B", 0.9), edge("C", "D", 0.9)];
    const clusters = buildClusters(edges, 0.5);
    expect(clusters).toHaveLength(2);
    const memberSets = clusters.map((c) => new Set(c.members));
    expect(memberSets.some((s) => s.has("A") && !s.has("C"))).toBe(true);
    expect(memberSets.some((s) => s.has("C") && !s.has("A"))).toBe(true);
  });
});

describe("timingCorrelationEdges", () => {
  it("links wallets that buy within the correlation window", () => {
    const trades: NormalizedTradeEvent[] = [
      mkTrade("W1", 1000),
      mkTrade("W2", 1005),
      mkTrade("W3", 1200),
    ];
    const edges = timingCorrelationEdges(trades);
    const pairs = edges.map((e) => [e.a, e.b].sort().join("-"));
    expect(pairs).toContain("W1-W2");
    expect(pairs).not.toContain("W1-W3");
  });
});

describe("evaluateClusterFlags", () => {
  it("flags coordinated buying and concentrated ownership for a tight cluster with dominant volume share", () => {
    const trades: NormalizedTradeEvent[] = [
      mkTrade("W1", 1000, 8000),
      mkTrade("W2", 1002, 8000),
      mkTrade("W3", 1004, 8000),
      mkTrade("Other", 1300, 500),
    ];
    const edges = timingCorrelationEdges(trades.filter((t) => t.wallet !== "Other"));
    const clusters = buildClusters(edges, 0.3, "TOK");
    expect(clusters).toHaveLength(1);
    const relationshipSource = new MockWalletRelationshipSource();
    const { flags, manipulationPenalty } = evaluateClusterFlags({
      cluster: clusters[0],
      tokenMint: "TOK",
      trades,
      tokenStats: undefined,
      relationshipSource,
      tokenIsRugged: false,
      manipulationPenaltyCap: 100,
    });
    expect(flags.coordinatedBuying).toBe(true);
    expect(flags.concentratedOwnership).toBe(true);
    expect(manipulationPenalty).toBeGreaterThan(0);
  });
});

function mkTrade(wallet: string, blockTime: number, usdValue = 1000): NormalizedTradeEvent {
  return {
    id: `id-${wallet}-${blockTime}`,
    wallet,
    tokenMint: "TOK",
    side: "BUY",
    tokenAmount: usdValue,
    usdValue,
    priceUsd: 1,
    dex: "raydium",
    pool: "TOK-pool",
    slot: 1,
    blockTime,
    txSignature: `sig-${wallet}-${blockTime}`,
    timestamps: { rawReceivedAt: blockTime * 1000 },
  };
}
