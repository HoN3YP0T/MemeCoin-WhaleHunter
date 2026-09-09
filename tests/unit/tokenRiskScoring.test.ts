import { readFileSync } from "node:fs";
import { parseStrategyConfig, type CreatorReputation, type TokenStats } from "@whale-sniper/core";
import { creatorRiskComponent, scoreTokenRisk } from "@whale-sniper/token-intel";
import { describe, expect, it } from "vitest";

const config = parseStrategyConfig(JSON.parse(readFileSync(new URL("../../config/strategy.json", import.meta.url), "utf-8")));

function baseTokenStats(overrides: Partial<TokenStats>): TokenStats {
  return {
    tokenMint: "T",
    createdAt: 1_000_000,
    liquidityUsd: 0,
    marketCapUsd: 0,
    holderCount: 0,
    top10HolderPct: 0,
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
    uniqueBuyers1h: 0,
    uniqueSellers1h: 0,
    buyVolumeUsd5m: 0,
    sellVolumeUsd5m: 0,
    buyVolumeUsd1h: 0,
    sellVolumeUsd1h: 0,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("tokenRiskScoring", () => {
  it("bands a mature, liquid, decentralized, authority-revoked token as very-low/low risk", () => {
    const stats = baseTokenStats({
      createdAt: 1_000_000 - 7 * 24 * 3600,
      liquidityUsd: 200000,
      top10HolderPct: 0.15,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      uniqueBuyers1h: 50,
      buyVolumeUsd5m: 5000,
      sellVolumeUsd5m: 1000,
    });
    const score = scoreTokenRisk(stats, config, 1_000_000);
    expect(score.riskScore).toBeLessThanOrEqual(40);
    expect(["very-low", "low"]).toContain(score.band);
  });

  it("bands a brand-new, illiquid, concentrated, authority-live token as high/extreme risk", () => {
    const stats = baseTokenStats({
      createdAt: 1_000_000 - 10,
      liquidityUsd: 1000,
      top10HolderPct: 0.9,
      mintAuthorityRevoked: false,
      freezeAuthorityRevoked: false,
      uniqueBuyers1h: 1,
      buyVolumeUsd5m: 200,
      sellVolumeUsd5m: 1800,
    });
    const score = scoreTokenRisk(stats, config, 1_000_000);
    expect(score.riskScore).toBeGreaterThanOrEqual(60);
    expect(["high", "extreme"]).toContain(score.band);
  });

  it("computes riskScore monotonically increasing with concentration risk", () => {
    const low = scoreTokenRisk(baseTokenStats({ top10HolderPct: 0.1 }), config, 1_000_000);
    const high = scoreTokenRisk(baseTokenStats({ top10HolderPct: 0.9 }), config, 1_000_000);
    expect(high.riskScore).toBeGreaterThan(low.riskScore);
  });
});

function reputation(overrides: Partial<CreatorReputation> = {}): CreatorReputation {
  return { creatorAddress: "C", tokensCreated: 0, tokensRugged: 0, updatedAt: Date.now(), ...overrides };
}

describe("creatorRiskComponent", () => {
  it("is exactly 0 when there is no creator data at all", () => {
    const stats = baseTokenStats({});
    expect(creatorRiskComponent(stats)).toBe(0);
    expect(creatorRiskComponent(stats, undefined)).toBe(0);
  });

  it("is exactly 0 for a first-time creator (launchCount 1) with no rug history", () => {
    const stats = baseTokenStats({ creatorTokenLaunchCount: 1 });
    expect(creatorRiskComponent(stats, reputation({ tokensCreated: 1, tokensRugged: 0 }))).toBe(0);
  });

  it("increases with the serial-deployer launch count, saturating around 10", () => {
    const stats5 = baseTokenStats({ creatorTokenLaunchCount: 5 });
    const stats11 = baseTokenStats({ creatorTokenLaunchCount: 11 });
    const stats50 = baseTokenStats({ creatorTokenLaunchCount: 50 });
    const r5 = creatorRiskComponent(stats5);
    const r11 = creatorRiskComponent(stats11);
    const r50 = creatorRiskComponent(stats50);
    expect(r5).toBeGreaterThan(0);
    expect(r11).toBeGreaterThan(r5);
    // Saturates at ~10 launches - going far past it shouldn't add unbounded risk.
    expect(r50).toBe(r11);
    expect(r11).toBeLessThanOrEqual(0.5); // launch-count signal is capped at 0.5 of the blended total
  });

  it("confidence-shrinks a thin-sample rug rate so a single rugged token barely moves risk", () => {
    const stats = baseTokenStats({});
    const thinSample = creatorRiskComponent(stats, reputation({ tokensCreated: 1, tokensRugged: 1 }));
    const provenSample = creatorRiskComponent(stats, reputation({ tokensCreated: 10, tokensRugged: 10 }));
    expect(thinSample).toBeGreaterThan(0);
    expect(thinSample).toBeLessThan(provenSample);
    expect(provenSample).toBeCloseTo(0.5, 5); // rug-rate signal is capped at 0.5 of the blended total
  });

  it("blends both signals when both are present", () => {
    const stats = baseTokenStats({ creatorTokenLaunchCount: 11 });
    const combined = creatorRiskComponent(stats, reputation({ tokensCreated: 10, tokensRugged: 10 }));
    expect(combined).toBeCloseTo(1, 5); // both sub-signals maxed out
  });

  it("contributes nothing to riskScore while tokenRiskWeights.creatorRisk is 0 (shipped default)", () => {
    expect(config.tokenRiskWeights.creatorRisk).toBe(0);
    const stats = baseTokenStats({ creatorTokenLaunchCount: 50 });
    const withoutReputation = scoreTokenRisk(stats, config, 1_000_000);
    const withReputation = scoreTokenRisk(stats, config, 1_000_000, reputation({ tokensCreated: 10, tokensRugged: 10 }));
    expect(withReputation.creatorRisk).toBeGreaterThan(0); // computed and visible...
    expect(withReputation.riskScore).toBe(withoutReputation.riskScore); // ...but contributes 0 while the weight is 0
  });
});
