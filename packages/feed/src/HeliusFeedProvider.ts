import type { ErrorHandler, FeedHealth, IFeedProvider, TradeEventHandler } from "@whale-sniper/core";
import { Connection, PublicKey, type Context, type Logs } from "@solana/web3.js";
import { decodePumpFunTradeLog, PUMP_FUN_PROGRAM_ID, pumpFunTradeToNormalizedEvent } from "./pumpFunDecoder.js";

/** Narrow surface of `@solana/web3.js`'s `Connection` this provider needs -
 * lets tests inject a fake instead of opening a real WebSocket. */
export interface ConnectionLike {
  onLogs(
    filter: PublicKey | "all",
    callback: (logs: Logs, ctx: Context) => void,
    commitment?: string,
  ): number;
  removeOnLogsListener(id: number): Promise<void>;
}

export interface HeliusFeedProviderOptions {
  /** Required - the caller (wiring.ts) is responsible for refusing to
   * construct this provider at all when HELIUS_API_KEY is unset, per the
   * "fail fast, never silently fall back" contract for FEED_PROVIDER=helius. */
  apiKey: string;
  /** pump.fun's bonding-curve program id. Overridable for tests/fixtures. */
  programId?: string;
  /** Static SOL/USD price used to convert decoded lamport amounts to USD -
   * see the comment on `PumpFunToNormalizedOptions` in pumpFunDecoder.ts for
   * why this isn't a live oracle in this build. */
  solUsdPrice?: number;
  /** DI seam for tests: skips opening a real Helius WebSocket. Defaults to
   * a real `@solana/web3.js` Connection against Helius's RPC/WS endpoint. */
  connectionFactory?: (wsUrl: string, httpUrl: string) => ConnectionLike;
}

const DEFAULT_SOL_USD_PRICE = 150;

function defaultConnectionFactory(wsUrl: string, httpUrl: string): ConnectionLike {
  return new Connection(httpUrl, { commitment: "confirmed", wsEndpoint: wsUrl });
}

/**
 * Real-time pump.fun feed backed by Helius's RPC/WS.
 *
 * Approach taken and why: Helius also offers a Geyser-enhanced gRPC
 * ("LaserStream") firehose, which is the lowest-latency option, but its
 * client is a heavier dependency and its exact wire contract is not
 * something this build can verify without a live API key to test against.
 * Instead this subscribes to `logsSubscribe` (via `@solana/web3.js`'s
 * `Connection.onLogs`) filtered to the pump.fun program id, over Helius's
 * standard RPC/WS URL - a plain, well-documented Solana JSON-RPC method
 * that doesn't require a publicly reachable webhook endpoint (which this
 * process doesn't have). It decodes the self-CPI-logged `TradeEvent` out of
 * each notification's logs via `pumpFunDecoder.ts`.
 *
 * Never selected unless the composition root (`wiring.ts`) explicitly opts
 * in with a real `HELIUS_API_KEY` - see that file for the fail-fast check.
 */
export class HeliusFeedProvider implements IFeedProvider {
  readonly name = "helius";

  private readonly programId: string;
  private readonly solUsdPrice: number;
  private readonly connectionFactory: (wsUrl: string, httpUrl: string) => ConnectionLike;

  private connection: ConnectionLike | undefined;
  private subscriptionId: number | undefined;
  private handlers: TradeEventHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private connected = false;
  private eventsReceived = 0;
  private errorsReceived = 0;
  private lastEventAt: number | undefined;

  constructor(private readonly options: HeliusFeedProviderOptions) {
    if (!options.apiKey) {
      // Defense in depth - wiring.ts already refuses to construct this
      // without a key, but the class itself must never silently proceed
      // unauthenticated if constructed some other way (e.g. directly in a
      // test or a future entry point).
      throw new Error("HeliusFeedProvider requires a non-empty apiKey (HELIUS_API_KEY)");
    }
    this.programId = options.programId ?? PUMP_FUN_PROGRAM_ID;
    this.solUsdPrice = options.solUsdPrice ?? DEFAULT_SOL_USD_PRICE;
    this.connectionFactory = options.connectionFactory ?? defaultConnectionFactory;
  }

  async connect(): Promise<void> {
    const httpUrl = `https://mainnet.helius-rpc.com/?api-key=${this.options.apiKey}`;
    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.options.apiKey}`;
    this.connection = this.connectionFactory(wsUrl, httpUrl);

    const programPubkey = new PublicKey(this.programId);
    this.subscriptionId = this.connection.onLogs(
      programPubkey,
      (logs, ctx) => {
        this.handleLogs(logs, ctx);
      },
      "confirmed",
    );
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connection && this.subscriptionId !== undefined) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
    }
    this.subscriptionId = undefined;
    this.connection = undefined;
    this.connected = false;
  }

  onEvent(handler: TradeEventHandler): void {
    this.handlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  health(): FeedHealth {
    return {
      provider: this.name,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      eventsReceived: this.eventsReceived,
      errorsReceived: this.errorsReceived,
    };
  }

  private handleLogs(logs: Logs, ctx: Context): void {
    try {
      const decoded = decodePumpFunTradeLog({ signature: logs.signature, err: logs.err, logs: logs.logs });
      if (!decoded) return; // not a trade event (or a failed tx) - not an error

      const normalized = pumpFunTradeToNormalizedEvent(decoded, {
        solUsdPrice: this.solUsdPrice,
        slot: ctx.slot,
        txSignature: logs.signature,
        receivedAt: Date.now(),
      });

      this.eventsReceived += 1;
      this.lastEventAt = Date.now();
      for (const handler of this.handlers) handler(normalized);
    } catch (err) {
      this.errorsReceived += 1;
      const error = err instanceof Error ? err : new Error(String(err));
      for (const handler of this.errorHandlers) handler(error);
    }
  }
}
