import type { Clock, EventBus, RuntimeFlags, StrategyConfig } from "@whale-sniper/core";
import { RuggedTokenRegistry, TokenFirstSeenIndex } from "@whale-sniper/core";
import { ClusterDetector, MockWalletRelationshipSource } from "@whale-sniper/cluster-detect";
import type { Repositories, WatchlistEntry } from "@whale-sniper/db";
import { ExecutionPipeline, PaperExecutionAdapter, RiskEngine, type IExecutionAdapter } from "@whale-sniper/execution";
import { MetricsStore } from "@whale-sniper/monitoring";
import { PositionManager } from "@whale-sniper/position-mgmt";
import {
  MockTokenMetadataProvider,
  TokenStatsCollector,
  type ITokenMetadataProvider,
  type TokenMetadataSeed,
} from "@whale-sniper/token-intel";
import { WalletStatsUpdater, WatchlistIndex } from "@whale-sniper/wallet-intel";
import { WhaleExitMonitor } from "@whale-sniper/whale-exit";
import { SniperOrchestrator } from "./SniperOrchestrator.js";

export interface BuildOrchestratorOptions {
  bus: EventBus;
  clock: Clock;
  config: StrategyConfig;
  repos: Repositories;
  runtimeFlags: RuntimeFlags;
  watchlist: WatchlistEntry[];
  executionAdapter?: IExecutionAdapter;
  tokenMetadataOverrides?: Array<{ tokenMint: string; metadata: TokenMetadataSeed }>;
  /** Overrides the default MockTokenMetadataProvider - e.g. a
   * DexScreenerTokenMetadataProvider when TOKEN_DATA_PROVIDER=dexscreener.
   * When set, `tokenMetadataOverrides` is ignored (it only makes sense for
   * the mock's deterministic per-mint seeding). */
  tokenMetadataProvider?: ITokenMetadataProvider;
}

export interface BuiltOrchestrator {
  orchestrator: SniperOrchestrator;
  metrics: MetricsStore;
  tokenMetadataProvider: ITokenMetadataProvider;
  relationshipSource: MockWalletRelationshipSource;
  riskEngine: RiskEngine;
}

/** Single place that assembles every sub-package into a SniperOrchestrator.
 * Both apps/sniper-runner (live) and backtest/replayEngine call this so
 * there is exactly one wiring path, not a live one and a parallel
 * backtest-only one. */
export function buildOrchestrator(options: BuildOrchestratorOptions): BuiltOrchestrator {
  const { bus, clock, config, repos, runtimeFlags } = options;

  const tokenFirstSeen = new TokenFirstSeenIndex();
  const ruggedRegistry = new RuggedTokenRegistry();
  const watchlistIndex = new WatchlistIndex();
  watchlistIndex.load(options.watchlist);

  const walletStatsUpdater = new WalletStatsUpdater(bus, repos.wallet, tokenFirstSeen, ruggedRegistry, clock);

  let tokenMetadataProvider: ITokenMetadataProvider;
  if (options.tokenMetadataProvider) {
    tokenMetadataProvider = options.tokenMetadataProvider;
  } else {
    const mockProvider = new MockTokenMetadataProvider();
    for (const override of options.tokenMetadataOverrides ?? []) {
      mockProvider.setOverride(override.tokenMint, override.metadata);
    }
    tokenMetadataProvider = mockProvider;
  }
  const tokenStatsCollector = new TokenStatsCollector(bus, repos.token, tokenMetadataProvider, tokenFirstSeen, ruggedRegistry, clock);

  const relationshipSource = new MockWalletRelationshipSource();
  const clusterDetector = new ClusterDetector(bus, repos.cluster, repos.token, relationshipSource, ruggedRegistry, config);

  const riskEngine = new RiskEngine(repos.riskState, runtimeFlags);
  const executionAdapter = options.executionAdapter ?? new PaperExecutionAdapter(config);
  const executionPipeline = new ExecutionPipeline(executionAdapter, riskEngine, repos.position, bus, config);

  const positionManager = new PositionManager(bus, repos.position, config);
  const whaleExitMonitor = new WhaleExitMonitor(bus, positionManager, config);

  const metrics = new MetricsStore();

  const orchestrator = new SniperOrchestrator({
    bus,
    clock,
    config,
    repos,
    watchlistIndex,
    tokenFirstSeen,
    ruggedRegistry,
    walletStatsUpdater,
    tokenStatsCollector,
    clusterDetector,
    executionPipeline,
    positionManager,
    whaleExitMonitor,
    metrics,
  });

  return { orchestrator, metrics, tokenMetadataProvider, relationshipSource, riskEngine };
}
