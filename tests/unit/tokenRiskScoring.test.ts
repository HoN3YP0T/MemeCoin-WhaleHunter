import { readFileSync } from "node:fs";
import { parseStrategyConfig, type CreatorReputation, type TokenStats } from "@whale-sniper/core";
import { conservativeUnknownSeed, creatorRiskComponent, scoreTokenRisk } from "@whale-sniper/token-intel";
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

/**
 * The reason `CompositeTokenMetadataProvider` exists, pinned as a test.
 *
 * `conservativeUnknownSeed()` - what a DexScreener-only setup is forced to
 * use for holder concentration and mint/freeze authority state - sets
 * `top10HolderPct: 1` and both authorities to *not revoked*. That maxes out
 * `concentrationRisk` (weight .20) and `authorityRisk` (weight .15) on every
 * single token, a flat 35-point floor on `riskScore` before age, liquidity,
 * buyer diversity or flow contribute anything. Against
 * `tokenThresholds.maxTokenRiskScore` (55) that floor alone rejects
 * essentially every realistic pump.fun token. Supplying those four fields
 * from standard Solana RPC removes the floor, which is the whole point of
 * the composite provider - so if a future weight/threshold change puts these
 * tokens back above the gate, this test should fail loudly.
 */
describe("token risk floor imposed by unknown holder/authority data", () => {
  const NOW = 1_000_000;

  // Realistic pump.fun profiles: a fresh-discovery launch and two more
  // established ones, all with healthy buy-dominant flow.
  const profiles = [
    { name: "1h old, $10k liquidity, 15 buyers", createdAt: NOW - 3_600, liquidityUsd: 10_000, uniqueBuyers1h: 15 },
    { name: "6h old, $50k liquidity, 30 buyers", createdAt: NOW - 21_600, liquidityUsd: 50_000, uniqueBuyers1h: 30 },
    { name: "6h old, $99k liquidity, 50 buyers", createdAt: NOW - 21_600, liquidityUsd: 99_000, uniqueBuyers1h: 50 },
  ];

  // What the RPC half of the composite provider actually measures for a
  // reasonable token: authorities renounced, top-10 holding 30%.
  const realRpcData = { top10HolderPct: 0.3, mintAuthorityRevoked: true, freezeAuthorityRevoked: true };
  const unknownRpcData = {
    top10HolderPct: conservativeUnknownSeed().top10HolderPct,
    mintAuthorityRevoked: conservativeUnknownSeed().mintAuthorityRevoked,
    freezeAuthorityRevoked: conservativeUnknownSeed().freezeAuthorityRevoked,
  };

  function score(profile: (typeof profiles)[number], rpcData: Partial<TokenStats>): number {
    const { name: _name, ...statsFromProfile } = profile;
    return scoreTokenRisk(
      baseTokenStats({ ...statsFromProfile, ...rpcData, buyVolumeUsd5m: 3_000, sellVolumeUsd5m: 1_000 }),
      config,
      NOW,
    ).riskScore;
  }

  it("is exactly 35 points wide - concentrationRisk .20 + authorityRisk .15, both maxed", () => {
    const w = config.tokenRiskWeights;
    const floor = 100 * (w.concentrationRisk * 1 + w.authorityRisk * 1);
    expect(floor).toBeCloseTo(35, 6);

    // And it really is additive on top of everything else: the same token
    // scored with fully-clean holder/authority data differs by exactly the
    // floor.
    const clean = score(profiles[0], { top10HolderPct: 0, mintAuthorityRevoked: true, freezeAuthorityRevoked: true });
    expect(score(profiles[0], unknownRpcData) - clean).toBeCloseTo(35, 6);
  });

  for (const profile of profiles) {
    it(`rejects "${profile.name}" on conservative fallback data but passes it on real RPC data`, () => {
      const withFallback = score(profile, unknownRpcData);
      const withRealData = score(profile, realRpcData);
      const gate = config.tokenThresholds.maxTokenRiskScore;

      expect(withFallback).toBeGreaterThan(gate);
      expect(withRealData).toBeLessThan(gate);
      expect(withFallback - withRealData).toBeCloseTo(29, 6); // 35 floor less the 6 points real 30% concentration keeps
    });
  }
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
