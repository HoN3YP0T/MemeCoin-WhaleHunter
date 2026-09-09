import { readFileSync } from "node:fs";
import {
  EventBus,
  RealClock,
  RuntimeFlags,
  createLogger,
  loadEnv,
  parseStrategyConfig,
  type AppEnv,
  type Logger,
  type StrategyConfig,
} from "@whale-sniper/core";
import { createRepositories, type Repositories, type WatchlistEntry } from "@whale-sniper/db";
import { FeedManager, HeliusFeedProvider, MockFeedProvider, allScenarios } from "@whale-sniper/feed";
import { AlertManager, MetricsStore, startHealthServer } from "@whale-sniper/monitoring";
import { buildOrchestrator, type SniperOrchestrator } from "@whale-sniper/orchestrator";
import { TelegramBot } from "@whale-sniper/telegram-bot";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");

export interface AppContext {
  env: AppEnv;
  config: StrategyConfig;
  bus: EventBus;
  repos: Repositories;
  runtimeFlags: RuntimeFlags;
  orchestrator: SniperOrchestrator;
  metrics: MetricsStore;
  feedManager: FeedManager;
  telegramBot: TelegramBot;
  alertManager: AlertManager;
  logger: Logger;
}

function loadStrategyConfig(): StrategyConfig {
  const raw = readFileSync(path.join(REPO_ROOT, "config", "strategy.json"), "utf-8");
  return parseStrategyConfig(JSON.parse(raw));
}

function loadWatchlist(): WatchlistEntry[] {
  const raw = readFileSync(path.join(REPO_ROOT, "config", "watchlist.json"), "utf-8");
  return (JSON.parse(raw) as { wallets: WatchlistEntry[] }).wallets;
}

export async function buildAppContext(): Promise<AppContext> {
  const env = loadEnv();
  const logger = createLogger("sniper-runner", env.LOG_LEVEL);
  const config = loadStrategyConfig();
  const watchlist = loadWatchlist();

  const bus = new EventBus();
  const runtimeFlags = new RuntimeFlags();
  const clock = new RealClock();
  const repos = await createRepositories(logger);

  for (const entry of watchlist) {
    await repos.watchlist.add(entry);
  }

  const scenarios = allScenarios();
  const tokenMetadataOverrides = scenarios.map((s) => ({ tokenMint: s.tokenMint, metadata: s.tokenMetadata }));

  const built = buildOrchestrator({ bus, clock, config, repos, runtimeFlags, watchlist, tokenMetadataOverrides });

  const feedProvider =
    env.FEED_PROVIDER === "helius"
      ? new HeliusFeedProvider()
      : new MockFeedProvider(
          scenarios.flatMap((s) => s.events),
          { playback: "paced", paceMs: 25 },
        );
  const feedManager = new FeedManager(feedProvider, bus, logger);

  const telegramBot = new TelegramBot({
    token: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    bus,
    positionRepo: repos.position,
    signalRepo: repos.signal,
    runtimeFlags,
    logger,
  });

  const alertManager = new AlertManager((message) => {
    logger.warn({}, message);
    void telegramBot.notify(message);
  });

  return {
    env,
    config,
    bus,
    repos,
    runtimeFlags,
    orchestrator: built.orchestrator,
    metrics: built.metrics,
    feedManager,
    telegramBot,
    alertManager,
    logger,
  };
}

export async function startApp(ctx: AppContext): Promise<{ stop: () => Promise<void> }> {
  ctx.orchestrator.start();
  await ctx.telegramBot.start();
  const healthServer = startHealthServer(ctx.env.HEALTH_PORT, ctx.metrics);

  try {
    await ctx.feedManager.start();
  } catch (err) {
    ctx.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      `feed provider "${ctx.env.FEED_PROVIDER}" failed to start`,
    );
    if (ctx.env.FEED_PROVIDER === "helius") {
      ctx.logger.warn({}, "HeliusFeedProvider is a stub - set FEED_PROVIDER=mock to run against the mock feed");
    }
  }

  const alertInterval = setInterval(() => {
    ctx.alertManager.check(ctx.metrics.snapshot());
  }, 10_000);

  return {
    stop: async () => {
      clearInterval(alertInterval);
      await ctx.feedManager.stop();
      await ctx.telegramBot.stop();
      ctx.orchestrator.stop();
      healthServer.close();
    },
  };
}
