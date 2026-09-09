import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://whale:whale@localhost:5432/whale_sniper?schema=public"),
  FEED_PROVIDER: z.enum(["mock", "helius"]).default("mock"),
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
