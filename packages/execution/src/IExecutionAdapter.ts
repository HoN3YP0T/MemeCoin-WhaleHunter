import type { TradeSide } from "@whale-sniper/core";

export interface OrderRequest {
  tokenMint: string;
  side: TradeSide;
  usdValue: number;
  quotePriceUsd: number;
  liquidityUsd: number;
}

export interface OrderResult {
  success: boolean;
  txSignature: string;
  filledPriceUsd: number;
  tokenAmount: number;
  feesUsd: number;
  slippagePct: number;
  submittedAt: number;
  confirmedAt: number;
  error?: string;
}

/** Every adapter (paper or live) implements this same shape, so the
 * execution pipeline never needs to know which one is behind it. */
export interface IExecutionAdapter {
  readonly name: string;
  submitOrder(order: OrderRequest): Promise<OrderResult>;
}
