import type { EventBus, IFeedProvider, Logger, NormalizedTradeEvent } from "@whale-sniper/core";

/** Owns the active feed provider and republishes its events onto the shared
 * event bus, so downstream packages never talk to a provider directly. */
export class FeedManager {
  constructor(
    private readonly provider: IFeedProvider,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.provider.onEvent((event: NormalizedTradeEvent) => {
      this.bus.emit("trade.normalized", event);
    });
    this.provider.onError((error: Error) => {
      this.logger.error({ err: error.message }, "feed error");
      this.bus.emit("feed.error", { provider: this.provider.name, message: error.message });
    });
    await this.provider.connect();
    this.bus.emit("feed.health", { provider: this.provider.name, healthy: true });
    this.logger.info({ provider: this.provider.name }, "feed connected");
  }

  async stop(): Promise<void> {
    await this.provider.disconnect();
    this.bus.emit("feed.health", { provider: this.provider.name, healthy: false });
  }

  health() {
    return this.provider.health();
  }
}
