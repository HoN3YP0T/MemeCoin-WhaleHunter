import type { ErrorHandler, FeedHealth, IFeedProvider, RawFeedEvent, TradeEventHandler } from "@whale-sniper/core";
import { decodeTradeEvent } from "./txDecoder.js";

export interface MockFeedProviderOptions {
  /** "instant" replays the whole script synchronously on connect() - used by
   * tests and backtests. "paced" spreads events out with real delays so a
   * live `npm run start` demo actually streams. */
  playback?: "instant" | "paced";
  paceMs?: number;
}

export class MockFeedProvider implements IFeedProvider {
  readonly name = "mock";
  private handlers: TradeEventHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private connected = false;
  private eventsReceived = 0;
  private errorsReceived = 0;
  private lastEventAt: number | undefined;
  private script: RawFeedEvent[];
  private options: Required<MockFeedProviderOptions>;
  private timer: NodeJS.Timeout | undefined;

  constructor(script: RawFeedEvent[], options: MockFeedProviderOptions = {}) {
    this.script = script;
    this.options = { playback: options.playback ?? "instant", paceMs: options.paceMs ?? 40 };
  }

  async connect(): Promise<void> {
    this.connected = true;
    if (this.options.playback === "instant") {
      this.replayAll();
    } else {
      this.replayPaced();
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.timer) clearTimeout(this.timer);
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

  private replayAll(): void {
    for (const raw of this.script) {
      this.emitOne(raw);
    }
  }

  private replayPaced(): void {
    let i = 0;
    const step = () => {
      if (!this.connected || i >= this.script.length) return;
      this.emitOne(this.script[i]);
      i += 1;
      this.timer = setTimeout(step, this.options.paceMs);
    };
    step();
  }

  private emitOne(raw: RawFeedEvent): void {
    try {
      const normalized = decodeTradeEvent(raw);
      this.eventsReceived += 1;
      this.lastEventAt = Date.now();
      for (const handler of this.handlers) handler(normalized);
    } catch (err) {
      this.errorsReceived += 1;
      for (const handler of this.errorHandlers) {
        handler(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
