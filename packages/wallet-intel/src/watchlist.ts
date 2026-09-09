import { readFile } from "node:fs/promises";
import { normalizeWatchlistEntry, type IWatchlistRepository, type WatchlistEntry, type WatchlistEntryStatus } from "@whale-sniper/db";

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

/**
 * In-memory index over the watchlist state machine (see
 * `WatchlistEntryStatus`). Backed by a `Map<address, WatchlistEntry>` (not
 * just a `Set<address>`) so it can answer both "is this wallet tradeable
 * right now" (`isWatched`) and "what status does this wallet have, if any"
 * (`statusOf` - used by `WhaleDiscoveryEngine` to decide whether a wallet
 * is a fresh candidate at all).
 */
export class WatchlistIndex {
  private entries = new Map<string, WatchlistEntry>();

  load(entries: WatchlistEntry[]): void {
    this.entries = new Map(entries.map((e) => {
      const normalized = normalizeWatchlistEntry(e);
      return [normalized.address, normalized];
    }));
  }

  /** Adds or overwrites a single entry in place - used by
   * `WhaleDiscoveryEngine` to promote/pend/reject an auto-discovered
   * wallet without reloading the entire watchlist. */
  upsert(entry: WatchlistEntry): void {
    const normalized = normalizeWatchlistEntry(entry);
    this.entries.set(normalized.address, normalized);
  }

  statusOf(wallet: string): WatchlistEntryStatus | undefined {
    return this.entries.get(wallet)?.status;
  }

  /** "Watched" means: an entry exists AND its status is "active" - a
   * "pending" or "rejected" auto-discovered candidate is not tradeable.
   * `SniperOrchestrator`'s existing gate check
   * (`if (!watchlistIndex.isWatched(event.wallet)) return;`) needed no code
   * change for the discovery state machine to work - this is exactly why. */
  isWatched(wallet: string): boolean {
    return this.entries.get(wallet)?.status === "active";
  }

  size(): number {
    return this.entries.size;
  }
}
