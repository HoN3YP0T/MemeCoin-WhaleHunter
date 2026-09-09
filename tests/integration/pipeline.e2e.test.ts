import { readFileSync } from "node:fs";
import {
  EventBus,
  RealClock,
  RuntimeFlags,
  createLogger,
  parseStrategyConfig,
  type NormalizedTradeEvent,
} from "@whale-sniper/core";
import { createInMemoryRepositories } from "@whale-sniper/db";
import { FeedManager, MockFeedProvider, normalWhaleBuyScenario, rugScenario } from "@whale-sniper/feed";
import { buildOrchestrator } from "@whale-sniper/orchestrator";
import { describe, expect, it } from "vitest";

const config = parseStrategyConfig(JSON.parse(readFileSync(new URL("../../config/strategy.json", import.meta.url), "utf-8")));
const watchlist = JSON.parse(readFileSync(new URL("../../config/watchlist.json", import.meta.url), "utf-8")).wallets;
const logger = createLogger("test", "silent");

// Lets already-queued microtasks (repository writes, chained async handlers
// off the synchronous MockFeedProvider replay) settle before assertions.
async function flush(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("full pipeline: mock feed -> intelligence -> signal -> entry gate -> paper trade", () => {
  it("opens a paper position for a normal, qualified whale buy into a healthy token", async () => {
    const bus = new EventBus();
    const repos = createInMemoryRepositories();
    const runtimeFlags = new RuntimeFlags();
    const clock = new RealClock();
    const scenario = normalWhaleBuyScenario();

    const built = buildOrchestrator({
      bus,
      clock,
      config,
      repos,
      runtimeFlags,
      watchlist,
      tokenMetadataOverrides: [{ tokenMint: scenario.tokenMint, metadata: scenario.tokenMetadata }],
    });
    built.orchestrator.start();

    const rejections: string[] = [];
    bus.on("signal.rejected", ({ reason }) => rejections.push(reason));

    const provider = new MockFeedProvider(scenario.events, { playback: "instant" });
    const feedManager = new FeedManager(provider, bus, logger);
    await feedManager.start();
    await flush();

    const positions = await repos.position.allPositions();
    const onScenarioToken = positions.filter((p) => p.tokenMint === scenario.tokenMint);

    expect(onScenarioToken.length, `expected an opened position; rejections were: ${rejections.join(" | ")}`).toBeGreaterThan(0);
    const opened = onScenarioToken[0];
    expect(opened.whaleState.wallet).toBe(scenario.whaleWallet);
    expect(opened.entryPriceUsd).toBeGreaterThan(0);

    const signal = await repos.signal.getSignal(opened.signalId);
    expect(signal?.tokenMint).toBe(scenario.tokenMint);
    expect(signal?.score).toBeGreaterThanOrEqual(config.entryGate.minSignalScore);
  });

  it("blocks entry via the entry gate for a coordinated rug token, even with a qualified whale", async () => {
    const bus = new EventBus();
    const repos = createInMemoryRepositories();
    const runtimeFlags = new RuntimeFlags();
    const clock = new RealClock();
    const scenario = rugScenario();

    const built = buildOrchestrator({
      bus,
      clock,
      config,
      repos,
      runtimeFlags,
      watchlist,
      tokenMetadataOverrides: [{ tokenMint: scenario.tokenMint, metadata: scenario.tokenMetadata }],
    });
    built.orchestrator.start();

    const rejections: string[] = [];
    bus.on("signal.rejected", ({ tokenMint, reason }) => {
      if (tokenMint === scenario.tokenMint) rejections.push(reason);
    });

    const provider = new MockFeedProvider(scenario.events, { playback: "instant" });
    const feedManager = new FeedManager(provider, bus, logger);
    await feedManager.start();
    await flush();

    const positions = await repos.position.allPositions();
    const onScenarioToken = positions.filter((p) => p.tokenMint === scenario.tokenMint);

    expect(onScenarioToken.length).toBe(0);
    expect(rejections.length).toBeGreaterThan(0);
  });
});

describe("mock feed produces fully-timestamped events end to end", () => {
  it("stamps every hot-path timestamp on every event", async () => {
    const scenario = normalWhaleBuyScenario();
    const received: NormalizedTradeEvent[] = [];
    const provider = new MockFeedProvider(scenario.events, { playback: "instant" });
    provider.onEvent((e) => received.push(e));
    await provider.connect();
    expect(received.length).toBe(scenario.events.length);
    for (const e of received) {
      expect(e.timestamps.rawReceivedAt).toBeTypeOf("number");
      expect(e.timestamps.decodedAt).toBeTypeOf("number");
    }
  });
});
