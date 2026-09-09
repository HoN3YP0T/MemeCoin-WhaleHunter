import { newId, type StrategyConfig } from "@whale-sniper/core";
import { simulateFill } from "@whale-sniper/paper-trading";
import type { IExecutionAdapter, OrderRequest, OrderResult } from "./IExecutionAdapter.js";

/** The default and only adapter used unless LIVE_TRADING_ENABLED=true.
 * Wraps paper-trading's fillSimulator behind the standard adapter
 * interface so the execution pipeline treats paper and live identically. */
export class PaperExecutionAdapter implements IExecutionAdapter {
  readonly name = "paper";

  constructor(private readonly config: StrategyConfig) {}

  async submitOrder(order: OrderRequest): Promise<OrderResult> {
    const submittedAt = Date.now();
    const fill = simulateFill(
      { side: order.side, usdValue: order.usdValue, quotePriceUsd: order.quotePriceUsd, liquidityUsd: order.liquidityUsd },
      this.config.execution,
    );
    // A tiny simulated confirmation delay keeps latency metrics meaningful
    // without slowing tests down.
    const confirmedAt = submittedAt + 1;

    return {
      success: true,
      txSignature: newId("papertx"),
      filledPriceUsd: fill.filledPriceUsd,
      tokenAmount: fill.tokenAmount,
      feesUsd: fill.feesUsd,
      slippagePct: fill.slippagePct,
      submittedAt,
      confirmedAt,
    };
  }
}
