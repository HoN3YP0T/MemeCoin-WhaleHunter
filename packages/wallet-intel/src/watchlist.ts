import { readFile } from "node:fs/promises";
import type { IWatchlistRepository, WatchlistEntry } from "@whale-sniper/db";

export interface WatchlistFileEntry {
  address: string;
  label?: string;
  notes?: string;
}

export async function loadWatchlistFile(path: string): Promise<WatchlistFileEntry[]> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as { wallets: WatchlistFileEntry[] };
  return parsed.wallets;
}

/** Loads config/watchlist.json into the watchlist repository (idempotent -
 * safe to call on every boot). Used by scripts/seed-watchlist.ts and by the
 * app composition root at startup. */
export async function seedWatchlistFromFile(path: string, repo: IWatchlistRepository): Promise<WatchlistEntry[]> {
  const entries = await loadWatchlistFile(path);
  for (const entry of entries) {
    await repo.add(entry);
  }
  return repo.load();
}

export class WatchlistIndex {
  private addresses = new Set<string>();

  load(entries: WatchlistEntry[]): void {
    this.addresses = new Set(entries.map((e) => e.address));
  }

  isWatched(wallet: string): boolean {
    return this.addresses.has(wallet);
  }

  size(): number {
    return this.addresses.size;
  }
}
