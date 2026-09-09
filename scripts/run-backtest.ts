import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrategyConfig , loadEnvFile } from "@whale-sniper/core";
import { buildReport, formatReport, runReplay } from "@whale-sniper/backtest";
import { allScenarios } from "@whale-sniper/feed";
import type { TokenStats } from "@whale-sniper/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv: string[]): { configPath: string } {
  const idx = argv.indexOf("--config");
  const configPath = idx >= 0 && argv[idx + 1] ? path.resolve(process.cwd(), argv[idx + 1]) : path.join(REPO_ROOT, "config", "strategy.json");
  return { configPath };
}

async function main(): Promise<void> {
  const { configPath } = parseArgs(process.argv.slice(2));
  const config = parseStrategyConfig(JSON.parse(readFileSync(configPath, "utf-8")));
  const watchlist = JSON.parse(readFileSync(path.join(REPO_ROOT, "config", "watchlist.json"), "utf-8")).wallets;

  console.log(`Running backtest with config: ${configPath}`);

  const scenarios = allScenarios();
  const events = scenarios.flatMap((s) => s.events);
  const tokenMetadataOverrides = scenarios.map((s) => ({ tokenMint: s.tokenMint, metadata: s.tokenMetadata }));

  const replay = await runReplay(events, { config, watchlist, tokenMetadataOverrides });

  const tokenStatsByMint = new Map<string, TokenStats>();
  for (const position of replay.positions) {
    if (tokenStatsByMint.has(position.tokenMint)) continue;
    const stats = await replay.repos.token.getStats(position.tokenMint);
    if (stats) tokenStatsByMint.set(position.tokenMint, stats);
  }

  const report = buildReport(replay.positions, replay.signals, tokenStatsByMint);
  console.log(formatReport(report));
  console.log("");
  console.log("=== Pipeline metrics ===");
  console.log(JSON.stringify(replay.metrics, null, 2));
}

main().catch((err) => {
  console.error("backtest run failed", err);
  process.exit(1);
});
