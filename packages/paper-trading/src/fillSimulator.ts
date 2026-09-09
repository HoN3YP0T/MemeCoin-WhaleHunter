import type { StrategyConfig, TradeSide } from "@whale-sniper/core";

export interface FillRequest {
  side: TradeSide;
  usdValue: number;
  quotePriceUsd: number;
  liquidityUsd: number;
}

export interface FillResult {
  filledPriceUsd: number;
  slippagePct: number;
  feesUsd: number;
  filledUsdValue: number; // usdValue net of slippage impact on price (gross of fees)
  tokenAmount: number;
}

/**
 * Realistic fill = quoted price shifted by a slippage model (base +
 * k * trade-size-relative-to-liquidity), fees = DEX fee % + a flat mocked
 * gas cost. Used both directly by paper-trading callers and, wrapped, by
 * execution's paperExecutionAdapter.
 */
export function simulateFill(request: FillRequest, config: StrategyConfig["execution"]): FillResult {
  const sizeImpactPct =
    request.liquidityUsd > 0 ? (request.usdValue / request.liquidityUsd) * config.slippageSizeImpactK * 100 : 100;
  const slippagePct = config.baseSlippagePct + sizeImpactPct;

  const direction = request.side === "BUY" ? 1 : -1;
  const filledPriceUsd = request.quotePriceUsd * (1 + direction * (slippagePct / 100));

  const feesUsd = request.usdValue * (config.dexFeePct / 100) + config.mockGasUsd;
  const tokenAmount = filledPriceUsd > 0 ? request.usdValue / filledPriceUsd : 0;

  return {
    filledPriceUsd,
    slippagePct,
    feesUsd,
    filledUsdValue: request.usdValue,
    tokenAmount,
  };
}

export function estimateSlippagePct(usdValue: number, liquidityUsd: number, config: StrategyConfig["execution"]): number {
  const sizeImpactPct = liquidityUsd > 0 ? (usdValue / liquidityUsd) * config.slippageSizeImpactK * 100 : 100;
  return config.baseSlippagePct + sizeImpactPct;
}
