import type { EventBus } from "@whale-sniper/core";

/** A single entry in the dashboard's live signal feed - either a signal that
 * passed the entry gate (persisted separately in ISignalRepository, but
 * mirrored here for a single chronological feed) or one that was rejected
 * (never persisted anywhere else - see RecentEventLog below). */
export interface RecentSignalEvent {
  kind: "generated" | "rejected";
  tokenMint: string;
  at: number; // ms epoch
  signalId?: string; // only set for "generated"
  score?: number; // only set for "generated"
  reason?: string; // only set for "rejected"
}

const DEFAULT_CAPACITY = 200;

/**
 * Rejected signals are never persisted (see ISignalRepository -
 * saveSignal/getSignal/recentSignals only ever see signals that passed the
 * entry gate) - only counted via MetricsStore.signalsRejected. The
 * dashboard's /api/signals feed wants to show *both* passed and rejected
 * signals in one chronological log, so this is a small in-process ring
 * buffer subscribed to the same bus events MetricsStore already listens to.
 * Net-new state, deliberately scoped small (capped, no persistence, resets
 * on restart) - the same tradeoff MetricsStore already makes.
 */
export class RecentEventLog {
  private events: RecentSignalEvent[] = [];

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  start(bus: EventBus): () => void {
    const unsubs = [
      bus.on("signal.generated", ({ signalId, tokenMint, score }) => {
        this.push({ kind: "generated", tokenMint, signalId, score, at: Date.now() });
      }),
      bus.on("signal.rejected", ({ tokenMint, reason }) => {
        this.push({ kind: "rejected", tokenMint, reason, at: Date.now() });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }

  private push(event: RecentSignalEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
  }

  /** Most recent first. */
  recent(limit: number = this.capacity): RecentSignalEvent[] {
    return [...this.events].reverse().slice(0, limit);
  }
}
