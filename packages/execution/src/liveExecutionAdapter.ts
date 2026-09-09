import type { AppEnv } from "@whale-sniper/core";
import type { IExecutionAdapter, OrderRequest, OrderResult } from "./IExecutionAdapter.js";

export class LiveTradingDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveTradingDisabledError";
  }
}

/**
 * Structurally-complete but explicitly gated. Implements IExecutionAdapter
 * so it is a drop-in replacement for PaperExecutionAdapter, but its
 * constructor refuses to build outside of a fully-configured, explicitly
 * enabled environment, and signing/submission is stubbed - both by design
 * for this build. Never selected unless LIVE_TRADING_ENABLED=true AND a
 * distinct hot wallet keypair path AND a max-balance cap are configured.
 */
export class LiveExecutionAdapter implements IExecutionAdapter {
  readonly name = "live";

  constructor(private readonly env: AppEnv) {
    if (!env.LIVE_TRADING_ENABLED) {
      throw new LiveTradingDisabledError("LIVE_TRADING_ENABLED is false - refusing to construct LiveExecutionAdapter");
    }
    if (!env.HOT_WALLET_KEYPAIR_PATH) {
      throw new LiveTradingDisabledError("HOT_WALLET_KEYPAIR_PATH is required for live trading");
    }
    if (!env.HOT_WALLET_MAX_BALANCE_USD || env.HOT_WALLET_MAX_BALANCE_USD <= 0) {
      throw new LiveTradingDisabledError("HOT_WALLET_MAX_BALANCE_USD must be a positive cap for live trading");
    }
  }

  async submitOrder(_order: OrderRequest): Promise<OrderResult> {
    throw new Error(
      "LiveExecutionAdapter.submitOrder is not implemented - signing and on-chain submission require a real " +
        "wallet/RPC integration that is intentionally out of scope for this build",
    );
  }
}

/** Picks the adapter to use. This is the single choke point that decides
 * live vs paper - it is what "never wired to a real wallet" cashes out to
 * in code. */
export function selectExecutionAdapterKind(env: AppEnv): "paper" | "live" {
  if (!env.LIVE_TRADING_ENABLED) return "paper";
  if (!env.HOT_WALLET_KEYPAIR_PATH || !env.HOT_WALLET_MAX_BALANCE_USD) return "paper";
  return "live";
}
