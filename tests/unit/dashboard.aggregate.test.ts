import type { Position, Signal, WalletScoreBreakdown } from "@whale-sniper/core";
import {
  buildCandidatesList,
  buildOpenPositions,
  buildOverview,
  buildTradesList,
  buildWhaleDetail,
  buildWhalesList,
} from "@whale-sniper/dashboard";
import { createInMemoryRepositories, type Repositories } from "@whale-sniper/db";
import { MetricsStore } from "@whale-sniper/monitoring";
import { describe, expect, it } from "vitest";

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    signalId: "sig-1",
    tokenMint: "TOKEN1",
    triggeringWallet: "WHALE1",
    triggeringTxSignature: "tx1",
    components: {
      whaleQuality: 80,
      tokenQuality: 80,
      liquidity: 80,
      buyingMomentum: 80,
      independentBuyers: 80,
      earlyEntryQuality: 80,
      manipulationPenalty: 0,
    },
    score: 88,
    generatedAt: Date.now(),
    ...overrides,
  };
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    positionId: "pos-1",
    tokenMint: "TOKEN1",
    signalId: "sig-1",
    status: "CLOSED",
    entryPriceUsd: 1,
    entryUsdValue: 500,
    tokenAmount: 500,
    remainingTokenAmount: 0,
    currentPriceUsd: 1.5,
    highWaterMarkPriceUsd: 1.6,
    lowWaterMarkPriceUsd: 0.9,
    stopLossPriceUsd: 0.8,
    trailingActive: false,
    takeProfitLevels: [],
    whaleState: {
      wallet: "WHALE1",
      entryTxSignature: "tx1",
      cumulativeSoldFraction: 0,
      tier: "NONE",
      lastCheckedAt: Date.now(),
    },
    realizedPnlUsd: 250,
    unrealizedPnlUsd: 0,
    mfePct: 0.6,
    maePct: -0.1,
    feesUsd: 2,
    openedAt: Date.now() - 60_000,
    closedAt: Date.now(),
    exitReason: "TAKE_PROFIT",
    ...overrides,
  };
}

function score(overrides: Partial<WalletScoreBreakdown> = {}): WalletScoreBreakdown {
  return {
    wallet: "WHALE1",
    consistency: 70,
    timing: 70,
    selectivity: 70,
    exitQuality: 70,
    rugAvoidance: 70,
    recentPerformance: 70,
    whaleScore: 82,
    passedHardGate: true,
    gateFailureReasons: [],
    computedAt: Date.now(),
    ...overrides,
  };
}

async function seededRepos(): Promise<Repositories> {
  const repos = createInMemoryRepositories();
  await repos.signal.saveSignal(signal());
  await repos.position.savePosition(position());
  await repos.position.savePosition(
    position({
      positionId: "pos-2",
      status: "OPEN",
      closedAt: undefined,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 40,
      openedAt: Date.now() + 1000, // strictly later than pos-1, for a deterministic "newest first" ordering
    }),
  );
  await repos.wallet.upsertScore(score());
  await repos.watchlist.add({ address: "WHALE1", label: "Whale One", status: "active", source: "manual" });
  await repos.watchlist.add({ address: "WHALE2", label: "Pending Whale", status: "pending", source: "auto-discovered" });
  await repos.wallet.upsertScore(score({ wallet: "WHALE2", whaleScore: 60, passedHardGate: false }));
  return repos;
}

describe("dashboard aggregate", () => {
  it("buildOverview reuses buildReport's win-rate/expectancy math and adds dashboard-only fields", async () => {
    const repos = await seededRepos();
    const metrics = new MetricsStore();
    metrics.recordRealizedPnl(250);

    const overview = await buildOverview(repos, metrics.snapshot());

    expect(overview.report.closedTrades).toBe(1);
    expect(overview.report.winRate).toBe(1);
    expect(overview.totalPositionCount).toBe(2);
    expect(overview.openPositionCount).toBe(1);
    expect(overview.avgWinUsd).toBe(250);
    expect(overview.watchlistCounts).toEqual({ active: 1, pending: 1, rejected: 0 });
  });

  it("buildTradesList joins each position to its signal score, newest first", async () => {
    const repos = await seededRepos();
    const rows = await buildTradesList(repos);
    expect(rows).toHaveLength(2);
    expect(rows[0].positionId).toBe("pos-2"); // opened later than pos-1
    expect(rows.find((r) => r.positionId === "pos-1")?.signalScore).toBe(88);
  });

  it("buildOpenPositions returns only OPEN positions", async () => {
    const repos = await seededRepos();
    const rows = await buildOpenPositions(repos);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("OPEN");
  });

  it("buildWhalesList joins watchlist entries to whale score and trade stats by whaleState.wallet", async () => {
    const repos = await seededRepos();
    const whales = await buildWhalesList(repos);
    expect(whales).toHaveLength(2);
    const whale1 = whales.find((w) => w.address === "WHALE1")!;
    expect(whale1.whaleScore).toBe(82);
    expect(whale1.tradeCount).toBe(2);
    expect(whale1.openTradeCount).toBe(1);
    expect(whale1.realizedPnlUsd).toBe(250);
    // sorted by whaleScore descending
    expect(whales[0].address).toBe("WHALE1");
  });

  it("buildWhaleDetail returns the watchlist entry, score, and filtered trade list for one wallet", async () => {
    const repos = await seededRepos();
    const detail = await buildWhaleDetail(repos, "WHALE1");
    expect(detail.entry?.label).toBe("Whale One");
    expect(detail.score?.whaleScore).toBe(82);
    expect(detail.trades).toHaveLength(2);
    expect(detail.trades.every((t) => t.wallet === "WHALE1")).toBe(true);
  });

  it("buildCandidatesList lists only pending watchlist entries with their score", async () => {
    const repos = await seededRepos();
    const candidates = await buildCandidatesList(repos);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].address).toBe("WHALE2");
    expect(candidates[0].whaleScore).toBe(60);
    expect(candidates[0].passedHardGate).toBe(false);
  });
});
