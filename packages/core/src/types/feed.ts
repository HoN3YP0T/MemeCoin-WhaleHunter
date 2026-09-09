import type { NormalizedTradeEvent } from "./events.js";

export interface FeedHealth {
  provider: string;
  connected: boolean;
  lastEventAt?: number;
  eventsReceived: number;
  errorsReceived: number;
}

export type TradeEventHandler = (event: NormalizedTradeEvent) => void;
export type ErrorHandler = (error: Error) => void;

/** Provider-agnostic real-time feed interface. Backed today by the mock
 * provider; a real Helius/Triton/etc adapter is a drop-in implementation. */
export interface IFeedProvider {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(handler: TradeEventHandler): void;
  onError(handler: ErrorHandler): void;
  health(): FeedHealth;
}
