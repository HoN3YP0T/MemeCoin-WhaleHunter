import type { EventBus, FeedHealth } from "@whale-sniper/core";

const MAX_SAMPLES = 500;

function pushCapped(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export interface MetricsSnapshot {
  feed: Record<string, FeedHealth>;
  signalsGenerated: number;
  signalsRejected: number;
  ordersSubmitted: number;
  ordersFailed: number;
  ordersConfirmed: number;
  latencyMsByStage: Record<string, { avg: number; p50: number; p95: number; count: number }>;
  slippagePct: { avg: number; p95: number };
  realizedPnlUsd: number;
  peakEquityUsd: number;
  currentEquityUsd: number;
  drawdownPct: number;
  openPositions: number;
  closedPositions: number;
}

/**
 * In-memory metrics only - this scaffold has no long-term metrics store,
 * so a restart resets everything. Good enough for a single-process runner
 * and for tests; a real deployment would ship these to Prometheus/Datadog.
 */
export class MetricsStore {
  private feedHealth = new Map<string, FeedHealth>();
  private signalsGenerated = 0;
  private signalsRejected = 0;
  private ordersSubmitted = 0;
  private ordersFailed = 0;
  private ordersConfirmed = 0;
  private latencySamples = new Map<string, number[]>();
  private slippageSamples: number[] = [];
  private realizedPnlUsd = 0;
  private peakEquityUsd = 0;
  private currentEquityUsd = 0;
  private openPositions = 0;
  private closedPositions = 0;

  start(bus: EventBus): () => void {
    const unsubs = [
      bus.on("feed.health", ({ provider, healthy }) => {
        this.recordFeedHealth({ provider, connected: healthy, eventsReceived: 0, errorsReceived: 0 });
      }),
      bus.on("signal.rejected", () => this.recordSignalRejected()),
      bus.on("position.opened", () => {
        this.openPositions += 1;
      }),
      bus.on("position.closed", () => {
        this.openPositions = Math.max(0, this.openPositions - 1);
        this.closedPositions += 1;
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }

  recordFeedHealth(health: FeedHealth): void {
    this.feedHealth.set(health.provider, health);
  }

  recordSignalGenerated(): void {
    this.signalsGenerated += 1;
  }

  recordSignalRejected(): void {
    this.signalsRejected += 1;
  }

  recordOrderSubmitted(): void {
    this.ordersSubmitted += 1;
  }

  recordOrderFailed(): void {
    this.ordersFailed += 1;
  }

  recordOrderConfirmed(): void {
    this.ordersConfirmed += 1;
  }

  recordLatency(stage: string, ms: number): void {
    const arr = this.latencySamples.get(stage) ?? [];
    pushCapped(arr, ms);
    this.latencySamples.set(stage, arr);
  }

  recordLatencies(stages: Record<string, number>): void {
    for (const [stage, ms] of Object.entries(stages)) this.recordLatency(stage, ms);
  }

  recordSlippage(pct: number): void {
    pushCapped(this.slippageSamples, pct);
  }

  recordRealizedPnl(deltaUsd: number): void {
    this.realizedPnlUsd += deltaUsd;
    this.currentEquityUsd += deltaUsd;
    this.peakEquityUsd = Math.max(this.peakEquityUsd, this.currentEquityUsd);
  }

  drawdownPct(): number {
    if (this.peakEquityUsd <= 0) return 0;
    return ((this.peakEquityUsd - this.currentEquityUsd) / this.peakEquityUsd) * 100;
  }

  snapshot(): MetricsSnapshot {
    const latencyMsByStage: MetricsSnapshot["latencyMsByStage"] = {};
    for (const [stage, samples] of this.latencySamples) {
      latencyMsByStage[stage] = { avg: avg(samples), p50: percentile(samples, 50), p95: percentile(samples, 95), count: samples.length };
    }

    return {
      feed: Object.fromEntries(this.feedHealth),
      signalsGenerated: this.signalsGenerated,
      signalsRejected: this.signalsRejected,
      ordersSubmitted: this.ordersSubmitted,
      ordersFailed: this.ordersFailed,
      ordersConfirmed: this.ordersConfirmed,
      latencyMsByStage,
      slippagePct: { avg: avg(this.slippageSamples), p95: percentile(this.slippageSamples, 95) },
      realizedPnlUsd: this.realizedPnlUsd,
      peakEquityUsd: this.peakEquityUsd,
      currentEquityUsd: this.currentEquityUsd,
      drawdownPct: this.drawdownPct(),
      openPositions: this.openPositions,
      closedPositions: this.closedPositions,
    };
  }
}
