import type { Logger } from "@whale-sniper/core";
import { getPrismaClient } from "./prismaClient.js";
import { createInMemoryRepositories } from "./repositories/inMemory.js";
import { createPrismaRepositories } from "./repositories/prisma.js";
import type { Repositories } from "./repositories/types.js";

/** Tries to build Postgres-backed repositories; falls back to in-memory
 * ones (with a warning) when @prisma/client was never generated or the
 * database is unreachable, so the rest of the app keeps running. */
export async function createRepositories(logger?: Logger): Promise<Repositories> {
  try {
    const prisma = await getPrismaClient();
    await prisma.$connect();
    logger?.info({}, "connected to Postgres via Prisma");
    return createPrismaRepositories(prisma);
  } catch (err) {
    logger?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "falling back to in-memory repositories - Postgres/Prisma unavailable",
    );
    return createInMemoryRepositories();
  }
}
