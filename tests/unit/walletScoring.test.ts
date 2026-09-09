import { readFileSync } from "node:fs";
import { parseStrategyConfig, type WalletStats } from "@whale-sniper/core";
import { scoreWallet } from "@whale-sniper/wallet-intel";
import { describe, expect, it } from "vitest";

const config = parseStrategyConfig(JSON.parse(readFileSync(new URL("../../config/strategy.json", import.meta.url), "utf-8")));

function baseStats(overrides: Partial<WalletStats>): WalletStats {
  return {
    wallet: "W",
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    realizedPnlUsd: 0,
    avgRoiPct: 0,
    maxDrawdownPct: 0,
    avgWhaleBuySizeUsd: 0,
    earlyEntryFrequency: 0,
    rugExposureCount: 0,
    lastTradeAt: Date.now(),
    firstTradeAt: Date.now() - 1000,
    ...overrides,
  };
}

describe("walletScoring", () => {
  it("passes the hard gate and scores highly for a strong, well-sampled wallet", () => {
    const stats = baseStats({
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
    });
    const result = scoreWallet(stats, config);
    expect(result.passedHardGate).toBe(true);
    expect(result.gateFailureReasons).toEqual([]);
    expect(result.whaleScore).toBeGreaterThanOrEqual(config.walletGate.minWhaleScore);
  });

  it("fails the hard gate for a wallet with poor stats", () => {
    const stats = baseStats({
      tradeCount: 20,
      winCount: 5,
      lossCount: 15,
      winRate: 0.25,
      realizedPnlUsd: -2000,
      avgRoiPct: -10,
      maxDrawdownPct: 80,
      avgWhaleBuySizeUsd: 500,
      earlyEntryFrequency: 0.05,
      rugExposureCount: 6,
    });
    const result = scoreWallet(stats, config);
    expect(result.passedHardGate).toBe(false);
    expect(result.gateFailureReasons.length).toBeGreaterThan(0);
  });

  it("shrinks a small-sample wallet's consistency score below a large-sample wallet with a lower raw win rate", () => {
    // 8 trades at 75% win rate (6 wins) - the "looks great but tiny sample" case.
    const smallSample = baseStats({
      tradeCount: 8,
      winCount: 6,
      lossCount: 2,
      winRate: 0.75,
      realizedPnlUsd: 12000,
      avgRoiPct: 40,
      maxDrawdownPct: 20,
      avgWhaleBuySizeUsd: 4000,
      earlyEntryFrequency: 0.5,
      rugExposureCount: 0,
    });
    // 200 trades at 64% win rate (128 wins) - proven, larger sample, lower raw rate.
    const largeSample = baseStats({
      tradeCount: 200,
      winCount: 128,
      lossCount: 72,
      winRate: 0.64,
      realizedPnlUsd: 12000,
      avgRoiPct: 40,
      maxDrawdownPct: 20,
      avgWhaleBuySizeUsd: 4000,
      earlyEntryFrequency: 0.5,
      rugExposureCount: 0,
    });

    const smallResult = scoreWallet(smallSample, config);
    const largeResult = scoreWallet(largeSample, config);

    expect(largeResult.consistency).toBeGreaterThan(smallResult.consistency);
  });
});
