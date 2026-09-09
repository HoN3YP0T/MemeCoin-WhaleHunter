import { readFileSync } from "node:fs";
import { parseStrategyConfig } from "@whale-sniper/core";
import { buildReport, buildGrid, runParameterSweep, runReplay } from "@whale-sniper/backtest";
import { allScenarios } from "@whale-sniper/feed";
import { describe, expect, it } from "vitest";

const config = parseStrategyConfig(JSON.parse(readFileSync(new URL("../../config/strategy.json", import.meta.url), "utf-8")));
const watchlist = JSON.parse(readFileSync(new URL("../../config/watchlist.json", import.meta.url), "utf-8")).wallets;

describe("backtest replayEngine", () => {
  it("replays every scenario through the live pipeline and produces a coherent report", async () => {
    const scenarios = allScenarios();
    const events = scenarios.flatMap((s) => s.events);
    const tokenMetadataOverrides = scenarios.map((s) => ({ tokenMint: s.tokenMint, metadata: s.tokenMetadata }));

    const replay = await runReplay(events, { config, watchlist, tokenMetadataOverrides });
    expect(replay.metrics.signalsGenerated).toBeGreaterThan(0);

    const report = buildReport(replay.positions, replay.signals);
    expect(report.totalTrades).toBeGreaterThan(0);
    expect(report.winRate).toBeGreaterThanOrEqual(0);
    expect(report.winRate).toBeLessThanOrEqual(1);
    expect(report.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  }, 20000);
});

describe("parameterSweep", () => {
  it("evaluates multiple minSignalScore thresholds and returns one report per candidate", async () => {
    const scenario = allScenarios()[0];
    const candidates = buildGrid(config, "entryGate.minSignalScore", [50, 65, 80], (c, v) => {
      c.entryGate.minSignalScore = v;
      return c;
    });

    const results = await runParameterSweep(scenario.events, candidates, watchlist, [{ tokenMint: scenario.tokenMint, metadata: scenario.tokenMetadata }]);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.report).toBeDefined();
    }
    // A stricter minSignalScore should never open *more* trades than a looser one.
    const strict = results.find((r) => r.label.includes("=80"))!;
    const loose = results.find((r) => r.label.includes("=50"))!;
    expect(strict.report.totalTrades).toBeLessThanOrEqual(loose.report.totalTrades);
  }, 20000);
});
