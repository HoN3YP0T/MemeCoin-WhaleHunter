export interface CreatorReputation {
  creatorAddress: string;
  tokensCreated: number;
  tokensRugged: number;
  updatedAt: number;
}

/**
 * Self-learned reputation for token creators/deployers, built purely from
 * this bot's own (unmodified) rug-detection logic in `TokenStatsCollector`
 * and creator-identity data from `SolscanTokenMetadataProvider` - see
 * `CreatorRegistryUpdater` in `token-intel` for how it's kept up to date.
 * Lives in `core` alongside `RuggedTokenRegistry` for the same reason: a
 * cheap, synchronous, in-memory primitive that multiple packages
 * (token-intel writes it, token-intel's tokenRiskScoring reads it) need to
 * share without depending on each other.
 */
export class CreatorRegistry {
  private reputations = new Map<string, CreatorReputation>();

  /** Loads persisted reputation (e.g. from `ICreatorRegistryRepository.loadAll()`
   * at boot) so reputation survives restarts. Replaces any in-memory state -
   * call once, before the registry starts receiving live updates. */
  hydrate(entries: CreatorReputation[]): void {
    this.reputations = new Map(entries.map((e) => [e.creatorAddress, e]));
  }

  /** Records that a token by this creator has been observed (i.e. we now
   * know who created it) - increments `tokensCreated`. Callers are
   * responsible for calling this at most once per token (see
   * `CreatorRegistryUpdater`'s idempotency set) so a creator's count tracks
   * distinct tokens, not distinct events. */
  recordTokenObserved(creatorAddress: string, now: number = Date.now()): CreatorReputation {
    const existing = this.reputations.get(creatorAddress);
    const updated: CreatorReputation = existing
      ? { ...existing, tokensCreated: existing.tokensCreated + 1, updatedAt: now }
      : { creatorAddress, tokensCreated: 1, tokensRugged: 0, updatedAt: now };
    this.reputations.set(creatorAddress, updated);
    return updated;
  }

  /** Records that a token by this creator has been flagged rugged
   * (`RuggedTokenRegistry.isRugged()`) - increments `tokensRugged`. Callers
   * are responsible for calling this at most once per token. */
  recordTokenRugged(creatorAddress: string, now: number = Date.now()): CreatorReputation {
    const existing = this.reputations.get(creatorAddress);
    const updated: CreatorReputation = existing
      ? { ...existing, tokensRugged: existing.tokensRugged + 1, updatedAt: now }
      : // Rugged before we ever recorded this creator's tokensCreated count
        // (shouldn't happen in the normal CreatorRegistryUpdater flow, which
        // always observes before it can flag rugged, but stay defensive
        // rather than losing the rug signal) - seed both counters at 1.
        { creatorAddress, tokensCreated: 1, tokensRugged: 1, updatedAt: now };
    this.reputations.set(creatorAddress, updated);
    return updated;
  }

  getReputation(creatorAddress: string): CreatorReputation | undefined {
    return this.reputations.get(creatorAddress);
  }

  all(): CreatorReputation[] {
    return [...this.reputations.values()];
  }
}
