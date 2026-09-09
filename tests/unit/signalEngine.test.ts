import { readFileSync } from "node:fs";
import type { Signal, TokenRiskScore, TokenStats, WalletCluster, WalletScoreBreakdown } from "@whale-sniper/core";
import { parseStrategyConfig } from "@whale-sniper/core";
import { evaluateEntryGate } from "@whale-sniper/signal-engine";
import { describe, expect, it } from "vitest";

const config = parseStrategyConfig(JSON.parse(readFileSync(new URL("../../config/strategy.json", import.meta.url), "utf-8")));

function goodWalletScore(): WalletScoreBreakdown {
  return {
    wallet: "W",
    consistency: 80,
    timing: 80,
    selectivity: 80,
    exitQuality: 80,
    rugAvoidance: 100,
    recentPerformance: 80,
    whaleScore: 85,
    passedHardGate: true,
    gateFailureReasons: [],
    computedAt: Date.now(),
  };
}

function goodTokenRisk(): TokenRiskScore {
  return {
    tokenMint: "T",
    ageRisk: 0.1,
    liquidityRisk: 0.1,
    concentrationRisk: 0.1,
    authorityRisk: 0,
    buyerDiversityRisk: 0.1,
    flowRisk: 0.1,
    riskScore: 15,
    band: "very-low",
    computedAt: Date.now(),
  };
}

function goodTokenStats(): TokenStats {
  return {
    tokenMint: "T",
    createdAt: 1_000_000,
    liquidityUsd: 60000,
    marketCapUsd: 200000,
    holderCount: 100,
    top10HolderPct: 0.3,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    uniqueBuyers1h: 20,
    uniqueSellers1h: 5,
    buyVolumeUsd5m: 5000,
    sellVolumeUsd5m: 500,
    buyVolumeUsd1h: 20000,
    sellVolumeUsd1h: 2000,
    updatedAt: Date.now(),
  };
}

function goodSignal(): Signal {
  return {
    signalId: "sig1",
    tokenMint: "T",
    triggeringWallet: "W",
    triggeringTxSignature: "tx1",
    components: {
      whaleQuality: 85,
      tokenQuality: 85,
      liquidity: 90,
      buyingMomentum: 80,
      independentBuyers: 90,
      earlyEntryQuality: 90,
      manipulationPenalty: 0,
    },
    score: 85,
    generatedAt: Date.now(),
  };
}

describe("strategy config weights", () => {
  it("wallet score weights sum to 1", () => {
    const w = config.walletScoreWeights;
    const sum = w.consistency + w.timing + w.selectivity + w.exitQuality + w.rugAvoidance + w.recentPerformance;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("token risk weights sum to 1", () => {
    const w = config.tokenRiskWeights;
    const sum = w.ageRisk + w.liquidityRisk + w.concentrationRisk + w.authorityRisk + w.buyerDiversityRisk + w.flowRisk;
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe("evaluateEntryGate", () => {
  it("passes when every condition clears", () => {
    const result = evaluateEntryGate(
      {
        walletScore: goodWalletScore(),
        tokenRisk: goodTokenRisk(),
        tokenStats: goodTokenStats(),
        signal: goodSignal(),
        estimatedSlippagePct: 1,
      },
      config,
    );
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("blocks on an unqualified whale", () => {
    const bad = { ...goodWalletScore(), passedHardGate: false, gateFailureReasons: ["tradeCount too low"] };
    const result = evaluateEntryGate(
      { walletScore: bad, tokenRisk: goodTokenRisk(), tokenStats: goodTokenStats(), signal: goodSignal(), estimatedSlippagePct: 1 },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("whale not qualified"))).toBe(true);
  });

  it("blocks on excessive token risk", () => {
    const risky = { ...goodTokenRisk(), riskScore: 90 };
    const result = evaluateEntryGate(
      { walletScore: goodWalletScore(), tokenRisk: risky, tokenStats: goodTokenStats(), signal: goodSignal(), estimatedSlippagePct: 1 },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("token risk"))).toBe(true);
  });

  it("blocks on insufficient liquidity", () => {
    const thin = { ...goodTokenStats(), liquidityUsd: 500 };
    const result = evaluateEntryGate(
      { walletScore: goodWalletScore(), tokenRisk: goodTokenRisk(), tokenStats: thin, signal: goodSignal(), estimatedSlippagePct: 1 },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("liquidity"))).toBe(true);
  });

  it("blocks on an active manipulation flag", () => {
    const cluster: WalletCluster = {
      clusterId: "c1",
      members: ["A", "B"],
      edges: [],
      flags: {
        concentratedOwnership: true,
        coordinatedBuying: false,
        immediateLargeSelling: false,
        creatorAssociatedWallets: false,
        suspiciousLiquidityBehavior: false,
      },
      manipulationPenalty: 20,
      computedAt: Date.now(),
    };
    const result = evaluateEntryGate(
      { walletScore: goodWalletScore(), tokenRisk: goodTokenRisk(), tokenStats: goodTokenStats(), signal: goodSignal(), estimatedSlippagePct: 1, cluster },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("manipulation"))).toBe(true);
  });

  it("blocks on insufficient independent buyers", () => {
    const thin = { ...goodTokenStats(), uniqueBuyers1h: 0 };
    const result = evaluateEntryGate(
      { walletScore: goodWalletScore(), tokenRisk: goodTokenRisk(), tokenStats: thin, signal: goodSignal(), estimatedSlippagePct: 1 },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("independent buyers"))).toBe(true);
  });

  it("blocks on insufficient buying momentum", () => {
    const quiet = { ...goodTokenStats(), buyVolumeUsd5m: 0 };
    const result = evaluateEntryGate(
      { walletScore: goodWalletScore(), tokenRisk: goodTokenRisk(), tokenStats: quiet, signal: goodSignal(), estimatedSlippagePct: 1 },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("buying momentum"))).toBe(true);
  });

  it("blocks on excessive slippage", () => {
    const result = evaluateEntryGate(
      { walletScore: goodWalletScore(), tokenRisk: goodTokenRisk(), tokenStats: goodTokenStats(), signal: goodSignal(), estimatedSlippagePct: 20 },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("slippage"))).toBe(true);
  });

  it("blocks on a low signal score", () => {
    const weak = { ...goodSignal(), score: 10 };
    const result = evaluateEntryGate(
      { walletScore: goodWalletScore(), tokenRisk: goodTokenRisk(), tokenStats: goodTokenStats(), signal: weak, estimatedSlippagePct: 1 },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("signal score"))).toBe(true);
  });

  it("blocks on a risk engine veto", () => {
    const result = evaluateEntryGate(
      {
        walletScore: goodWalletScore(),
        tokenRisk: goodTokenRisk(),
        tokenStats: goodTokenStats(),
        signal: goodSignal(),
        estimatedSlippagePct: 1,
        riskEngineVeto: { vetoed: true, reason: "daily loss limit reached" },
      },
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("risk engine veto"))).toBe(true);
  });
});
