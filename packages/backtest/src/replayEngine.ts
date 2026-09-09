import { EventBus, RuntimeFlags, SimulatedClock, type Position, type RawFeedEvent, type Signal, type StrategyConfig } from "@whale-sniper/core";
import { createInMemoryRepositories, type Repositories, type WatchlistEntry } from "@whale-sniper/db";
import { decodeTradeEvent, type ScenarioTokenMetadata } from "@whale-sniper/feed";
import { buildOrchestrator } from "@whale-sniper/orchestrator";
import type { MetricsSnapshot } from "@whale-sniper/monitoring";

export interface ReplayOptions {
  config: StrategyConfig;
  watchlist: WatchlistEntry[];
  tokenMetadataOverrides?: Array<{ tokenMint: string; metadata: ScenarioTokenMetadata }>;
  /** How many microtask-flush rounds to wait after each event before moving
   * on to the next. The pipeline's async chain (repo writes, cluster
   * detection) is shallow, so a handful of rounds is enough to let it fully
   * settle before the next event is allowed to advance the clock -
   * preserving strict in-order, no-lookahead processing. */
  settleRoundsPerEvent?: number;
}

export interface ReplayResult {
  positions: Position[];
  signals: Signal[];
  metrics: MetricsSnapshot;
  repos: Repositories;
}

async function flush(rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Replays a stored sequence of RawFeedEvents through the exact same
 * pipeline code the live app runs (via buildOrchestrator/SniperOrchestrator)
 * - this is not a parallel backtest-only implementation. A SimulatedClock
 * is advanced strictly forward to each event's own blockTime before that
 * event is processed, and events are sorted ascending first, so wallet/
 * token/cluster state is only ever built from events that have "already
 * happened" relative to the point being evaluated.
 */
export async function runReplay(events: RawFeedEvent[], options: ReplayOptions): Promise<ReplayResult> {
  const sorted = [...events].sort((a, b) => a.blockTime - b.blockTime);
  const bus = new EventBus();
  const repos = createInMemoryRepositories();
  const runtimeFlags = new RuntimeFlags();
  const clock = new SimulatedClock(sorted.length > 0 ? sorted[0].blockTime * 1000 : 0);

  const built = buildOrchestrator({
    bus,
    clock,
    config: options.config,
    repos,
    runtimeFlags,
    watchlist: options.watchlist,
    tokenMetadataOverrides: options.tokenMetadataOverrides,
  });
  built.orchestrator.start();

  const settleRounds = options.settleRoundsPerEvent ?? 5;
  for (const raw of sorted) {
    clock.advanceTo(raw.blockTime * 1000);
    const normalized = decodeTradeEvent(raw, () => clock.now());
    bus.emit("trade.normalized", normalized);
    await flush(settleRounds);
  }
  await flush(settleRounds * 2);

  built.orchestrator.stop();

  const positions = await repos.position.allPositions();
  const signals = await repos.signal.recentSignals(100000);

  return { positions, signals, metrics: built.metrics.snapshot(), repos };
}
