/**
 * Every time-dependent computation in the pipeline (wallet stats, token
 * stats, entry gate, position ticks) reads "now" through a Clock instead of
 * calling Date.now()/setTimeout directly. In live mode that's a thin wrapper
 * over real time; in backtest mode it's a SimulatedClock driven by the
 * event replay loop. This is what makes replayEngine "no lookahead" possible:
 * stats are only ever computed as-of the SimulatedClock's current position,
 * which advances strictly with the events being replayed.
 */
export interface Clock {
  now(): number; // ms epoch
  sleep(ms: number): Promise<void>;
}

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }
  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class SimulatedClock implements Clock {
  private currentMs: number;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  /** Advance the clock. Replay code calls this as it processes each event;
   * it must never move backwards. */
  advanceTo(ms: number): void {
    if (ms > this.currentMs) this.currentMs = ms;
  }

  async sleep(): Promise<void> {
    // No real waiting in backtests - time advances only via advanceTo().
    return Promise.resolve();
  }
}
