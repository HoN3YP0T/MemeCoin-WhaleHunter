import { readFileSync } from "node:fs";
import type { Signal, TokenStats } from "@whale-sniper/core";
import { parseStrategyConfig } from "@whale-sniper/core";
import { applyPaperExit, openPaperPosition, simulateFill } from "@whale-sniper/paper-trading";
import { describe, expect, it } from "vitest";

const config = parseStrategyConfig(JSON.parse(readFileSync(new URL("../../config/strategy.json", import.meta.url), "utf-8")));

function tokenStats(): TokenStats {
  return {
    tokenMint: "T",
    createdAt: 0,
    liquidityUsd: 50000,
    marketCapUsd: 200000,
    holderCount: 100,
    top10HolderPct: 0.3,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    uniqueBuyers1h: 10,
    uniqueSellers1h: 2,
    buyVolumeUsd5m: 3000,
    sellVolumeUsd5m: 200,
    buyVolumeUsd1h: 10000,
    sellVolumeUsd1h: 1000,
    updatedAt: Date.now(),
  };
}

function signal(): Signal {
  return {
    signalId: "s1",
    tokenMint: "T",
    triggeringWallet: "W",
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
    score: 80,
    generatedAt: Date.now(),
  };
}

describe("fillSimulator", () => {
  it("applies more slippage to larger trades relative to liquidity", () => {
    const small = simulateFill({ side: "BUY", usdValue: 100, quotePriceUsd: 1, liquidityUsd: 50000 }, config.execution);
    const large = simulateFill({ side: "BUY", usdValue: 20000, quotePriceUsd: 1, liquidityUsd: 50000 }, config.execution);
    expect(large.slippagePct).toBeGreaterThan(small.slippagePct);
    expect(large.filledPriceUsd).toBeGreaterThan(small.filledPriceUsd);
  });

  it("fills sells at a worse (lower) price than quote", () => {
    const fill = simulateFill({ side: "SELL", usdValue: 1000, quotePriceUsd: 2, liquidityUsd: 50000 }, config.execution);
    expect(fill.filledPriceUsd).toBeLessThan(2);
  });
});

describe("paperTradeEngine lifecycle", () => {
  it("opens a position and applies a profitable partial exit", () => {
    const position = openPaperPosition(signal(), "W", "tx1", tokenStats(), 1000, 1, config);
    expect(position.status).toBe("OPEN");
    expect(position.remainingTokenAmount).toBeGreaterThan(0);

    const result = applyPaperExit(position, position.entryPriceUsd * 1.5, 0.2, tokenStats().liquidityUsd, config, undefined);
    expect(result.position.status).toBe("OPEN"); // partial exit
    expect(result.position.realizedPnlUsd).toBeGreaterThan(-position.feesUsd); // improved vs just entry fees
  });

  it("fully closes a position when the sell fraction consumes all remaining size", () => {
    const position = openPaperPosition(signal(), "W", "tx1", tokenStats(), 1000, 1, config);
    const result = applyPaperExit(position, position.entryPriceUsd * 0.8, 1, tokenStats().liquidityUsd, config, "STOP_LOSS");
    expect(result.position.status).toBe("CLOSED");
    expect(result.position.exitReason).toBe("STOP_LOSS");
    expect(result.position.remainingTokenAmount).toBe(0);
  });
});
