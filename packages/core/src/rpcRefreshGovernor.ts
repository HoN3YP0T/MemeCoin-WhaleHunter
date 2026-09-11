/**
 * Rate-limit governor shared by every "synchronous read, throttled
 * background refresh" provider in this repo.
 *
 * It lives in `core` rather than next to its first consumer because there
 * is now more than one: `CompositeTokenMetadataProvider`
 * (`token-intel`, 3 RPC calls per mint refresh) and
 * `SolanaRpcWalletRelationshipSource` (`cluster-detect`, up to
 * `maxSignaturePages + 1` calls per wallet/mint lookup) both talk to the
 * *same* Helius endpoint on the *same* HELIUS_API_KEY. Two independently
 * tuned throttles would each believe it owned the whole quota; one shared
 * governor instance means the operator's rate limit is spent once, not
 * twice. Passing the same instance to both providers is what actually
 * shares the quota - constructing one each still shares the tuning, which
 * is the weaker (but still correct-by-default) arrangement.
 *
 * - `minIntervalMs` spaces out refresh *starts* across all keys, capping
 *   steady-state refreshes/s no matter how many distinct keys the feed
 *   throws at the provider.
 * - `maxConcurrent` bounds how many refreshes can be open at once, so a
 *   slow endpoint queues rather than fanning out unboundedly.
 * - `perMintRetryCooldownMs` stops a key whose refresh *failed* from being
 *   retried on every subsequent synchronous read - without it a cold,
 *   failing key re-triggers forever, since a failure deliberately leaves no
 *   cache entry behind.
 *
 * Dropping a refresh is always safe: consumers' reads are synchronous and
 * return cached-or-fallback either way, so throttling only ever delays
 * better data, it never blocks a trade decision.
 */
export interface RpcRefreshBudget {
  minIntervalMs: number;
  maxConcurrent: number;
  /** Per-cache-key cooldown after a failed refresh. Named for its first
   * consumer (a token mint); for `cluster-detect` the key is a wallet or
   * mint address instead. */
  perMintRetryCooldownMs: number;
}

export const DEFAULT_RPC_REFRESH_BUDGET: RpcRefreshBudget = {
  minIntervalMs: 250,
  maxConcurrent: 4,
  perMintRetryCooldownMs: 5_000,
};

export function resolveRpcRefreshBudget(partial?: Partial<RpcRefreshBudget>): RpcRefreshBudget {
  return { ...DEFAULT_RPC_REFRESH_BUDGET, ...partial };
}

export interface TryStartOptions {
  /** Skip the per-key retry cooldown. Consumers pass this for a key that
   * already has a (merely stale) cache entry: such a key is already
   * rate-limited by its own TTL, and applying the cooldown on top would pin
   * refreshes to whichever of the two is longer. */
  skipRetryCooldown?: boolean;
}

export class RpcRefreshGovernor {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly lastAttemptAt = new Map<string, number>();
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  constructor(
    readonly budget: RpcRefreshBudget = DEFAULT_RPC_REFRESH_BUDGET,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts `task` in the background if the budget allows, and reports
   * whether it did. Never throws and never returns a promise to await: the
   * caller is on a synchronous hot path by construction. */
  tryStart(key: string, task: () => Promise<void>, options: TryStartOptions = {}): boolean {
    if (this.inFlight.has(key)) return false;
    const now = this.now();
    if (!options.skipRetryCooldown) {
      const lastAttempt = this.lastAttemptAt.get(key);
      if (lastAttempt !== undefined && now - lastAttempt < this.budget.perMintRetryCooldownMs) return false;
    }
    if (this.inFlight.size >= this.budget.maxConcurrent) return false;
    if (now - this.lastStartedAt < this.budget.minIntervalMs) return false;

    this.lastStartedAt = now;
    this.lastAttemptAt.set(key, now);
    const p = Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return true;
  }

  /** Test/diagnostic helper: how many refreshes are currently open. */
  inFlightCount(): number {
    return this.inFlight.size;
  }
}
