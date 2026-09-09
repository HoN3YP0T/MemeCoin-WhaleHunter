import { describe, expect, it, vi } from "vitest";
import { DexScreenerTokenMetadataProvider, type TokenDataHttpClient } from "./dexScreenerTokenMetadataProvider.js";

const MINT = "SomeTokenMint1111111111111111111111111111";

function fakeHttpClient(responses: Record<string, unknown>): TokenDataHttpClient {
  return {
    fetchJson: vi.fn(async (url: string) => {
      const hit = Object.entries(responses).find(([mint]) => url.endsWith(mint));
      if (!hit) throw new Error(`no fake response configured for ${url}`);
      return hit[1];
    }),
  };
}

function goodDexScreenerResponse(overrides: Partial<{ liquidityUsd: number; marketCap: number; chainId: string }> = {}) {
  return {
    schemaVersion: "1.0.0",
    pairs: [
      {
        chainId: overrides.chainId ?? "solana",
        dexId: "pumpfun",
        liquidity: { usd: overrides.liquidityUsd ?? 8000 },
        marketCap: overrides.marketCap ?? 45000,
        fdv: 45000,
        pairCreatedAt: 1_700_000_000_000,
      },
    ],
  };
}

describe("DexScreenerTokenMetadataProvider", () => {
  it("returns a conservative unknown seed before any fetch completes", () => {
    const http = fakeHttpClient({ [MINT]: goodDexScreenerResponse() });
    const provider = new DexScreenerTokenMetadataProvider(http, 20_000, () => 0);

    const seed = provider.get(MINT);
    expect(seed.liquidityUsd).toBe(0);
    expect(seed.mintAuthorityRevoked).toBe(false);
    expect(seed.freezeAuthorityRevoked).toBe(false);
    expect(seed.top10HolderPct).toBe(1);
  });

  it("caches a successful fetch and serves it on subsequent get() calls", async () => {
    const http = fakeHttpClient({ [MINT]: goodDexScreenerResponse({ liquidityUsd: 12345, marketCap: 67890 }) });
    let now = 0;
    const provider = new DexScreenerTokenMetadataProvider(http, 20_000, () => now);

    provider.get(MINT); // triggers background fetch
    await flushMicrotasks();

    const seed = provider.get(MINT);
    expect(seed.liquidityUsd).toBe(12345);
    expect(seed.marketCapUsd).toBe(67890);
    // DexScreener can't tell us these - always the conservative fallback.
    expect(seed.holderCount).toBe(0);
    expect(seed.mintAuthorityRevoked).toBe(false);
    expect(seed.freezeAuthorityRevoked).toBe(false);

    now += 1_000;
    provider.get(MINT);
    expect((http.fetchJson as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1); // still within TTL
  });

  it("re-fetches after the cache TTL expires", async () => {
    const http = fakeHttpClient({ [MINT]: goodDexScreenerResponse() });
    let now = 0;
    const provider = new DexScreenerTokenMetadataProvider(http, 1_000, () => now);

    await provider.prefetch(MINT);
    expect((http.fetchJson as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    now += 500;
    provider.get(MINT);
    await flushMicrotasks();
    expect((http.fetchJson as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1); // still fresh

    now += 2_000;
    provider.get(MINT); // stale - triggers a new background fetch
    await flushMicrotasks();
    expect((http.fetchJson as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("keeps the last cached value on a fetch failure instead of throwing", async () => {
    let shouldFail = false;
    const http: TokenDataHttpClient = {
      fetchJson: vi.fn(async () => {
        if (shouldFail) throw new Error("network down");
        return goodDexScreenerResponse({ liquidityUsd: 9999 });
      }),
    };
    let now = 0;
    const provider = new DexScreenerTokenMetadataProvider(http, 1_000, () => now);

    await provider.prefetch(MINT);
    expect(provider.get(MINT).liquidityUsd).toBe(9999);

    shouldFail = true;
    now += 5_000;
    provider.get(MINT); // triggers a failing background refresh
    await flushMicrotasks();

    // Still serving the last known-good value, not a thrown error or a
    // silently-reset-to-zero seed.
    expect(provider.get(MINT).liquidityUsd).toBe(9999);
  });

  it("falls back to the conservative seed when DexScreener returns no pairs for the mint", async () => {
    const http = fakeHttpClient({ [MINT]: { schemaVersion: "1.0.0", pairs: null } });
    const provider = new DexScreenerTokenMetadataProvider(http, 20_000, () => 0);

    await provider.prefetch(MINT);
    const seed = provider.get(MINT);
    expect(seed.liquidityUsd).toBe(0);
    expect(seed.mintAuthorityRevoked).toBe(false);
  });

  it("picks the highest-liquidity solana pair when several are returned", async () => {
    const http = fakeHttpClient({
      [MINT]: {
        pairs: [
          { chainId: "solana", liquidity: { usd: 1000 }, marketCap: 5000 },
          { chainId: "ethereum", liquidity: { usd: 999999 }, marketCap: 999999 },
          { chainId: "solana", liquidity: { usd: 25000 }, marketCap: 80000 },
        ],
      },
    });
    const provider = new DexScreenerTokenMetadataProvider(http, 20_000, () => 0);
    await provider.prefetch(MINT);
    const seed = provider.get(MINT);
    expect(seed.liquidityUsd).toBe(25000);
    expect(seed.marketCapUsd).toBe(80000);
  });

  it("de-duplicates concurrent refreshes for the same mint", async () => {
    const http = fakeHttpClient({ [MINT]: goodDexScreenerResponse() });
    const provider = new DexScreenerTokenMetadataProvider(http, 20_000, () => 0);

    provider.get(MINT);
    provider.get(MINT);
    provider.get(MINT);
    await flushMicrotasks();

    expect((http.fetchJson as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
