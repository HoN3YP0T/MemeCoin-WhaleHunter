import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://whale:whale@localhost:5432/whale_sniper?schema=public"),
  FEED_PROVIDER: z.enum(["mock", "helius"]).default("mock"),
  // Empty by default - no real key exists yet. wiring.ts refuses to select
  // FEED_PROVIDER=helius when this is unset rather than silently falling
  // back to the mock feed.
  HELIUS_API_KEY: z.string().optional().default(""),
  TOKEN_DATA_PROVIDER: z.enum(["mock", "dexscreener", "solscan"]).default("mock"),
  // Empty by default - no real key exists yet. wiring.ts's
  // buildTokenMetadataProvider() refuses to select TOKEN_DATA_PROVIDER=solscan
  // when this is unset rather than silently falling back to mock/dexscreener,
  // mirroring HELIUS_API_KEY's fail-fast contract above.
  SOLSCAN_API_KEY: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  LIVE_TRADING_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  HOT_WALLET_KEYPAIR_PATH: z.string().optional().default(""),
  HOT_WALLET_MAX_BALANCE_USD: z
    .string()
    .optional()
    .default("0")
    .transform((v) => Number(v) || 0),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HEALTH_PORT: z
    .string()
    .default("3001")
    .transform((v) => Number(v) || 3001),
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Loads a `.env` file into `process.env`, if one exists.
 *
 * Must be called by every entry point BEFORE `loadEnv()`. Without it a
 * `.env` file is inert - the schema below reads `process.env` and nothing
 * else, so an operator who sets HELIUS_API_KEY there gets silently dropped
 * back to the mock feed with no error explaining why.
 *
 * Uses Node's built-in `process.loadEnvFile` (v20.12+/21.7+; this repo
 * requires >=22) rather than the dotenv package - no dependency needed.
 * Existing process env vars win, so `FEED_PROVIDER=mock npm run start`
 * still overrides the file.
 */
export function loadEnvFile(path = ".env"): boolean {
  const before = { ...process.env };
  try {
    process.loadEnvFile(path);
  } catch {
    return false; // absent or unreadable - mock mode needs no .env
  }
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) process.env[key] = value;
  }
  return true;
}

let cached: AppEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  cached = envSchema.parse(source);
  return cached;
}

/** Test-only: clear the memoized env so a fresh loadEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
