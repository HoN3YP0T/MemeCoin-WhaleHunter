import type { RawFeedEvent, StrategyConfig } from "@whale-sniper/core";
import type { WatchlistEntry } from "@whale-sniper/db";
import type { ScenarioTokenMetadata } from "@whale-sniper/feed";
import { runReplay } from "./replayEngine.js";
import { buildReport, type BacktestReport } from "./reportBuilder.js";
import type { TokenStats } from "@whale-sniper/core";

export interface SweepCandidate {
  label: string;
  config: StrategyConfig;
}

export interface SweepResult {
  label: string;
  report: BacktestReport;
}

/** Runs the same replayed event sequence once per candidate config and
 * reports back so thresholds/weights can be recalibrated by comparing
 * expectancy/win-rate/drawdown across the grid. Deliberately reuses
 * runReplay (the exact same pipeline), so a sweep candidate is evaluated
 * identically to how the live app would have behaved under that config. */
export async function runParameterSweep(
  events: RawFeedEvent[],
  candidates: SweepCandidate[],
  watchlist: WatchlistEntry[],
  tokenMetadataOverrides?: Array<{ tokenMint: string; metadata: ScenarioTokenMetadata }>,
): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  for (const candidate of candidates) {
    const replay = await runReplay(events, { config: candidate.config, watchlist, tokenMetadataOverrides });
    const tokenStatsByMint = new Map<string, TokenStats>();
    for (const position of replay.positions) {
      if (tokenStatsByMint.has(position.tokenMint)) continue;
      const stats = await replay.repos.token.getStats(position.tokenMint);
      if (stats) tokenStatsByMint.set(position.tokenMint, stats);
    }
    const report = buildReport(replay.positions, replay.signals, tokenStatsByMint);
    results.push({ label: candidate.label, report });
  }
  return results;
}

/** Convenience grid-builder: varies a single numeric leaf of the config
 * (via a setter) across `values`, holding everything else fixed. */
export function buildGrid(base: StrategyConfig, paramLabel: string, values: number[], apply: (config: StrategyConfig, value: number) => StrategyConfig): SweepCandidate[] {
  return values.map((value) => ({ label: `${paramLabel}=${value}`, config: apply(structuredClone(base), value) }));
}
