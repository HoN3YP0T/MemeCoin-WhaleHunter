import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger , loadEnvFile } from "@whale-sniper/core";
import { createRepositories } from "@whale-sniper/db";
import { seedWatchlistFromFile } from "@whale-sniper/wallet-intel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

async function main(): Promise<void> {
  const logger = createLogger("seed-watchlist");
  const repos = await createRepositories(logger);
  const watchlistPath = path.join(REPO_ROOT, "config", "watchlist.json");
  const entries = await seedWatchlistFromFile(watchlistPath, repos.watchlist);
  logger.info({ count: entries.length }, "watchlist seeded");
  for (const entry of entries) {
    console.log(`  ${entry.address}  ${entry.label ?? ""}`);
  }
}

main().catch((err) => {
  console.error("failed to seed watchlist", err);
  process.exit(1);
});
