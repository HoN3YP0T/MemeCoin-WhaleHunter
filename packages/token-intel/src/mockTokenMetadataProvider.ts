export interface TokenMetadataSeed {
  liquidityUsd: number;
  marketCapUsd: number;
  holderCount: number;
  top10HolderPct: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
}

function deterministicHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function defaultMetadataFor(tokenMint: string): TokenMetadataSeed {
  const r = deterministicHash(tokenMint);
  return {
    liquidityUsd: 5000 + r * 40000,
    marketCapUsd: 20000 + r * 200000,
    holderCount: 10 + Math.floor(r * 200),
    top10HolderPct: 0.4 + r * 0.4,
    mintAuthorityRevoked: r > 0.5,
    freezeAuthorityRevoked: r > 0.5,
  };
}

/**
 * Stands in for a real on-chain / Birdeye / DexScreener metadata source. A
 * real adapter would implement the same shape (tokenMint -> TokenMetadataSeed)
 * against a live API. Scenario generators and tests can pin exact metadata
 * for a mint via `setOverride`; anything else gets a deterministic
 * pseudo-random profile so behavior is stable across runs.
 */
export class MockTokenMetadataProvider {
  private overrides = new Map<string, TokenMetadataSeed>();

  setOverride(tokenMint: string, metadata: TokenMetadataSeed): void {
    this.overrides.set(tokenMint, metadata);
  }

  get(tokenMint: string): TokenMetadataSeed {
    return this.overrides.get(tokenMint) ?? defaultMetadataFor(tokenMint);
  }
}
