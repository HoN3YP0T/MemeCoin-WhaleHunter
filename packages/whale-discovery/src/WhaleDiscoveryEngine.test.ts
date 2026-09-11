import { readFileSync } from "node:fs";
import { EventBus, parseStrategyConfig, type StrategyConfig, type WalletCluster, type WalletStats } from "@whale-sniper/core";
import { InMemoryWatchlistRepository } from "@whale-sniper/db";
import { WatchlistIndex } from "@whale-sniper/wallet-intel";
import { describe, expect, it } from "vitest";
import {
  WhaleDiscoveryEngine,
  type ClusterSource,
  type RelationshipWarmthSource,
  type WalletStatsSource,
} from "./WhaleDiscoveryEngine.js";

const baseConfig = parseStrategyConfig(JSON.parse(readFileSync(new URL("../../../config/strategy.json", import.meta.url), "utf-8")));

function discoveryConfig(overrides: Partial<StrategyConfig["walletDiscovery"]> = {}): StrategyConfig {
  return { ...baseConfig, walletDiscovery: { ...baseConfig.walletDiscovery, enabled: true, autoPromote: false, ...overrides } };
}

function strongWalletStats(overrides: Partial<WalletStats> = {}): WalletStats {
  // Mirrors tests/unit/walletScoring.test.ts's "passes the hard gate"
  // fixture - a wallet that genuinely clears config/strategy.json's
  // walletGate thresholds.
  return {
    wallet: "W",
    tradeCount: 40,
    winCount: 30,
    lossCount: 10,
    winRate: 0.75,
    realizedPnlUsd: 60000,
    avgRoiPct: 55,
    maxDrawdownPct: 15,
    avgWhaleBuySizeUsd: 5000,
    earlyEntryFrequency: 0.7,
    rugExposureCount: 0,
    lastTradeAt: Date.now(),
    firstTradeAt: Date.now() - 1000,
    ...overrides,
  };
}

function weakWalletStats(): WalletStats {
  return {
    wallet: "W",
    tradeCount: 2,
    winCount: 1,
    lossCount: 1,
    winRate: 0.5,
    realizedPnlUsd: 100,
    avgRoiPct: 5,
    maxDrawdownPct: 90,
    avgWhaleBuySizeUsd: 100,
    earlyEntryFrequency: 0,
    rugExposureCount: 0,
    lastTradeAt: Date.now(),
    firstTradeAt: Date.now() - 1000,
  };
}

function statsSource(stats: WalletStats | undefined): WalletStatsSource {
  return { getStats: () => stats };
}

function noClusters(): ClusterSource {
  return { detectForToken: async () => [] };
}

function clusterWith(flags: Partial<WalletCluster["flags"]>, members: string[]): ClusterSource {
  const cluster: WalletCluster = {
    clusterId: "cluster-1",
    members,
    edges: [],
    flags: {
      concentratedOwnership: false,
      coordinatedBuying: false,
      immediateLargeSelling: false,
      creatorAssociatedWallets: false,
      suspiciousLiquidityBehavior: false,
      ...flags,
    },
    manipulationPenalty: 0,
    computedAt: Date.now(),
  };
  return { detectForToken: async () => [cluster] };
}

function buildEngine(opts: {
  config: StrategyConfig;
  walletStatsSource: WalletStatsSource;
  clusterSource: ClusterSource;
  watchlistIndex?: WatchlistIndex;
  watchlistRepo?: InMemoryWatchlistRepository;
  relationshipSource?: RelationshipWarmthSource;
}) {
  const bus = new EventBus();
  const watchlistIndex = opts.watchlistIndex ?? new WatchlistIndex();
  const watchlistRepo = opts.watchlistRepo ?? new InMemoryWatchlistRepository();
  const engine = new WhaleDiscoveryEngine({
    bus,
    config: opts.config,
    watchlistIndex,
    watchlistRepo,
    walletStatsSource: opts.walletStatsSource,
    clusterSource: opts.clusterSource,
    relationshipSource: opts.relationshipSource,
  });
  return { bus, watchlistIndex, watchlistRepo, engine };
}

describe("WhaleDiscoveryEngine", () => {
  it("is a no-op when walletDiscovery.enabled is false (the shipped default)", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: { ...baseConfig, walletDiscovery: { enabled: false, autoPromote: false } },
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: noClusters(),
    });
    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBeUndefined();
    expect(baseConfig.walletDiscovery.enabled).toBe(false); // shipped default really is off
  });

  it("does not promote a wallet that hasn't cleared the hard gate (hard-gate reuse)", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: discoveryConfig(),
      walletStatsSource: statsSource(weakWalletStats()),
      clusterSource: noClusters(),
    });
    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBeUndefined();
  });

  it("moves a wallet that clears the hard gate to pending when autoPromote is false, and emits wallet.discovery-candidate", async () => {
    const { bus, engine, watchlistIndex, watchlistRepo } = buildEngine({
      config: discoveryConfig({ autoPromote: false }),
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: noClusters(),
    });
    const events: Array<{ wallet: string; whaleScore: number }> = [];
    bus.on("wallet.discovery-candidate", (e) => events.push(e));

    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBe("pending");
    expect(watchlistIndex.isWatched("W")).toBe(false); // pending is not tradeable
    expect(events).toHaveLength(1);
    expect(events[0].wallet).toBe("W");

    const persisted = await watchlistRepo.load();
    expect(persisted.find((e) => e.address === "W")?.status).toBe("pending");
    expect(persisted.find((e) => e.address === "W")?.source).toBe("auto-discovered");
  });

  it("goes straight to active and emits wallet.discovery-promoted when autoPromote is true", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: discoveryConfig({ autoPromote: true }),
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: noClusters(),
    });
    const events: Array<{ wallet: string; whaleScore: number }> = [];
    bus.on("wallet.discovery-promoted", (e) => events.push(e));
    const candidateEvents: unknown[] = [];
    bus.on("wallet.discovery-candidate", (e) => candidateEvents.push(e));

    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBe("active");
    expect(watchlistIndex.isWatched("W")).toBe(true);
    expect(events).toHaveLength(1);
    expect(candidateEvents).toHaveLength(0);
  });

  it("auto-rejects a wallet whose cluster is flagged creatorAssociatedWallets, even though it cleared the hard gate", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: discoveryConfig({ autoPromote: true }), // even with autoPromote on, cluster rejection wins
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: clusterWith({ creatorAssociatedWallets: true }, ["W"]),
    });
    const promoted: unknown[] = [];
    bus.on("wallet.discovery-promoted", (e) => promoted.push(e));

    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBe("rejected");
    expect(watchlistIndex.isWatched("W")).toBe(false);
    expect(promoted).toHaveLength(0);
  });

  it("auto-rejects a wallet whose cluster is flagged coordinatedBuying", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: discoveryConfig(),
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: clusterWith({ coordinatedBuying: true }, ["W"]),
    });
    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBe("rejected");
  });

  it("does not reject over a cluster the wallet isn't even a member of", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: discoveryConfig(),
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: clusterWith({ creatorAssociatedWallets: true }, ["SomeoneElse"]),
    });
    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBe("pending");
  });

  it("never re-processes or re-notifies a wallet that already has any status (active, pending, or rejected)", async () => {
    const watchlistIndex = new WatchlistIndex();
    watchlistIndex.load([{ address: "AlreadyActive", status: "active", source: "manual" }]);
    const { bus, engine } = buildEngine({
      config: discoveryConfig({ autoPromote: true }),
      walletStatsSource: statsSource(strongWalletStats({ wallet: "AlreadyActive" })),
      clusterSource: noClusters(),
      watchlistIndex,
    });
    const promoted: unknown[] = [];
    bus.on("wallet.discovery-promoted", (e) => promoted.push(e));

    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "AlreadyActive", tokenMint: "T" });
    await flush();

    // Still exactly the manually-set entry - untouched, and no discovery
    // event fired for a wallet that was never a fresh candidate.
    expect(watchlistIndex.statusOf("AlreadyActive")).toBe("active");
    expect(promoted).toHaveLength(0);
  });

  it("does not auto-promote on unknown relationship data (un-warmed cache), and promotes once it warms", async () => {
    // An RPC-backed relationship source answers "not yet checked" until its
    // background funder/deployer lookups land. That must not read as
    // "checked, clean" - see the fail-closed comment in handle().
    let warm = false;
    const relationshipSource: RelationshipWarmthSource = { relationshipDataKnown: () => warm };
    const { bus, engine, watchlistIndex, watchlistRepo } = buildEngine({
      config: discoveryConfig({ autoPromote: true }),
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: noClusters(), // no cluster found - indistinguishable from "not looked up yet"
      relationshipSource,
    });
    const promoted: unknown[] = [];
    bus.on("wallet.discovery-promoted", (e) => promoted.push(e));

    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    // Deferred, not promoted and not rejected: still unstatused, so still
    // not tradeable, and still a candidate on its next trade.
    expect(watchlistIndex.statusOf("W")).toBeUndefined();
    expect(watchlistIndex.isWatched("W")).toBe(false);
    expect(promoted).toHaveLength(0);
    expect(await watchlistRepo.load()).toHaveLength(0);

    // Same wallet, next trade, cache now warm - the deferral is a delay,
    // not a permanent disqualification.
    warm = true;
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBe("active");
    expect(promoted).toHaveLength(1);
  });

  it("still auto-rejects on a flagged cluster even when relationship data is warm", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: discoveryConfig({ autoPromote: true }),
      walletStatsSource: statsSource(strongWalletStats()),
      clusterSource: clusterWith({ creatorAssociatedWallets: true }, ["W"]),
      relationshipSource: { relationshipDataKnown: () => true },
    });
    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBe("rejected");
  });

  it("returns undefined for a wallet with no stats yet, without throwing", async () => {
    const { bus, engine, watchlistIndex } = buildEngine({
      config: discoveryConfig(),
      walletStatsSource: statsSource(undefined),
      clusterSource: noClusters(),
    });
    engine.start();
    bus.emit("wallet.stats-updated", { wallet: "W", tokenMint: "T" });
    await flush();

    expect(watchlistIndex.statusOf("W")).toBeUndefined();
  });
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
