/**
 * Lazily loads @prisma/client. The generated client only exists after
 * `npx prisma generate`, which needs network access to fetch query-engine
 * binaries - not guaranteed in every environment this repo is built in. By
 * importing it dynamically and only on first real use, everything that does
 * not touch Postgres (paper trading against in-memory repos, tests, the
 * mock feed, backtests) keeps working even when the client was never
 * generated.
 */
export async function getPrismaClient(): Promise<any> {
  const mod = await import("@prisma/client");
  const PrismaClient = (mod as any).PrismaClient;
  return new PrismaClient();
}
