import type { ErrorHandler, FeedHealth, IFeedProvider, TradeEventHandler } from "@whale-sniper/core";

/**
 * Structural stub for a real Helius (or Triton/Geyser/etc) feed adapter.
 * Implements the same IFeedProvider interface as MockFeedProvider so it is
 * a drop-in once real credentials and a decoding pipeline exist. Not wired
 * up in this build - every method throws until implemented.
 */
export class HeliusFeedProvider implements IFeedProvider {
  readonly name = "helius";

  constructor(private readonly apiKey?: string) {}

  async connect(): Promise<void> {
    throw new Error("HeliusFeedProvider is not implemented - provide real credentials and a decoder first");
  }

  async disconnect(): Promise<void> {
    throw new Error("HeliusFeedProvider is not implemented");
  }

  onEvent(_handler: TradeEventHandler): void {
    throw new Error("HeliusFeedProvider is not implemented");
  }

  onError(_handler: ErrorHandler): void {
    throw new Error("HeliusFeedProvider is not implemented");
  }

  health(): FeedHealth {
    return { provider: this.name, connected: false, eventsReceived: 0, errorsReceived: 0 };
  }
}
