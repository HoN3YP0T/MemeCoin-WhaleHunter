import { readFileSync } from "node:fs";
import { parseStrategyConfig, type TokenStats } from "@whale-sniper/core";
import { scoreTokenRisk } from "@whale-sniper/token-intel";
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
