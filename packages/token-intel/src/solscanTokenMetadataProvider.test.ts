import { describe, expect, it, vi } from "vitest";
import type { TokenDataHttpClient } from "./tokenMetadataProvider.js";
import { SolscanTokenMetadataProvider } from "./solscanTokenMetadataProvider.js";

const MINT = "SomeTokenMint1111111111111111111111111111";
const CREATOR = "SomeCreatorWallet111111111111111111111111";

function fakeHttpClient(byUrlSubstring: Record<string, unknown>): TokenDataHttpClient {
  return {
    fetchJson: vi.fn(async (url: string) => {
      const hit = Object.entries(byUrlSubstring).find(([needle]) => url.includes(needle));
      if (!hit) throw new Error(`no fake response configured for ${url}`);
      const value = hit[1];
      if (value instanceof Error) throw value;
      return value;
    }),
  };
}

function goodMetaResponse(overrides: Partial<{ creator: string; marketCap: number; holder: number; mintAuthority: string | null; freezeAuthority: string | null }> = {}) {
  return {
    success: true,
    data: {
      address: MINT,
      creator: overrides.creator ?? CREATOR,
      marketCap: overrides.marketCap ?? 90000,
      holder: overrides.holder ?? 250,
      mintAuthority: overrides.mintAuthority === undefined ? null : overrides.mintAuthority,
      freezeAuthority: overrides.freezeAuthority === undefined ? null : overrides.freezeAuthority,
    },
  };
}

function goodHoldersResponse(percentages: number[] = [10, 8, 7, 6, 5, 4, 3, 2, 1, 1]) {
  return {
    success: true,
    data: {
      total: 1000,
      items: percentages.map((pct, i) => ({ address: `holder${i}`, percentage: pct, rank: i + 1 })),
    },
  };
}

function goodActivitiesResponse(total = 4) {
  return { success: true, total, data: [] };
}

describe("SolscanTokenMetadataProvider", () => {
  it("throws on construction with an empty apiKey", () => {
    expect(() => new SolscanTokenMetadataProvider("")).toThrow(/apiKey/i);
  });

  it("returns a conservative unknown seed before any fetch completes", () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse(),
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": goodActivitiesResponse(),
    });
    const provider = new SolscanTokenMetadataProvider("test-key", http, 20_000, () => 0);

    const seed = provider.get(MINT);
    expect(seed.liquidityUsd).toBe(0);
    expect(seed.mintAuthorityRevoked).toBe(false);
    expect(seed.freezeAuthorityRevoked).toBe(false);
    expect(seed.top10HolderPct).toBe(1);
    expect(seed.creatorAddress).toBeUndefined();
    expect(seed.creatorTokenLaunchCount).toBeUndefined();
  });

  it("caches a successful fetch and fills creatorAddress/creatorTokenLaunchCount from the account-activity lookup", async () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse({ marketCap: 123456, holder: 400 }),
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": goodActivitiesResponse(7),
    });
    const provider = new SolscanTokenMetadataProvider("test-key", http, 20_000, () => 0);

    await provider.prefetch(MINT);
    const seed = provider.get(MINT);

    expect(seed.marketCapUsd).toBe(123456);
    expect(seed.holderCount).toBe(400);
    expect(seed.creatorAddress).toBe(CREATOR);
    expect(seed.creatorTokenLaunchCount).toBe(7);
  });

  it("passes the api key as an auth header on every request", async () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse(),
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": goodActivitiesResponse(),
    });
    const provider = new SolscanTokenMetadataProvider("my-secret-key", http, 20_000, () => 0);
    await provider.prefetch(MINT);

    const calls = (http.fetchJson as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, headers] of calls) {
      expect(headers).toMatchObject({ token: "my-secret-key" });
    }
  });

  it("reads mint/freeze authority as revoked only on an explicit null, not a missing field", async () => {
    const http = fakeHttpClient({
      "/token/meta": {
        success: true,
        data: { address: MINT, marketCap: 1000, holder: 10 }, // no mintAuthority/freezeAuthority keys at all
      },
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": goodActivitiesResponse(),
    });
    const provider = new SolscanTokenMetadataProvider("test-key", http, 20_000, () => 0);
    await provider.prefetch(MINT);
    const seed = provider.get(MINT);

    // Missing field => unknown => conservative "not revoked" (risky), same
    // policy as DexScreener's fallback - never a coin-flip toward "safe".
    expect(seed.mintAuthorityRevoked).toBe(false);
    expect(seed.freezeAuthorityRevoked).toBe(false);
  });

  it("reads mint/freeze authority as revoked when Solscan explicitly reports null", async () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse({ mintAuthority: null, freezeAuthority: null }),
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": goodActivitiesResponse(),
    });
    const provider = new SolscanTokenMetadataProvider("test-key", http, 20_000, () => 0);
    await provider.prefetch(MINT);
    const seed = provider.get(MINT);

    expect(seed.mintAuthorityRevoked).toBe(true);
    expect(seed.freezeAuthorityRevoked).toBe(true);
  });

  it("computes top10HolderPct by summing the top 10 holders' percentage shares", async () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse(),
      "/token/holders": goodHoldersResponse([20, 15, 10, 5, 5, 5, 5, 5, 5, 5]), // sums to 80
      "/account/defi/activities": goodActivitiesResponse(),
    });
    const provider = new SolscanTokenMetadataProvider("test-key", http, 20_000, () => 0);
    await provider.prefetch(MINT);
    const seed = provider.get(MINT);

    expect(seed.top10HolderPct).toBeCloseTo(0.8, 5);
  });

  it("leaves creatorTokenLaunchCount undefined (neutral) when the creator-activity lookup fails, without discarding the rest of the refresh", async () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse({ marketCap: 5000 }),
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": new Error("rate limited"),
    });
    const provider = new SolscanTokenMetadataProvider("test-key", http, 20_000, () => 0);
    await provider.prefetch(MINT);
    const seed = provider.get(MINT);

    expect(seed.marketCapUsd).toBe(5000);
    expect(seed.creatorAddress).toBe(CREATOR);
    expect(seed.creatorTokenLaunchCount).toBeUndefined();
  });

  it("keeps the last cached value when the token/meta fetch fails, instead of throwing or resetting to conservative", async () => {
    let failMeta = false;
    const http: TokenDataHttpClient = {
      fetchJson: vi.fn(async (url: string) => {
        if (url.includes("/token/meta")) {
          if (failMeta) throw new Error("network down");
          return goodMetaResponse({ marketCap: 9999 });
        }
        if (url.includes("/token/holders")) return goodHoldersResponse();
        if (url.includes("/account/defi/activities")) return goodActivitiesResponse();
        throw new Error(`unexpected url ${url}`);
      }),
    };
    let now = 0;
    const provider = new SolscanTokenMetadataProvider("test-key", http, 1_000, () => now);

    await provider.prefetch(MINT);
    expect(provider.get(MINT).marketCapUsd).toBe(9999);

    failMeta = true;
    now += 5_000;
    provider.get(MINT); // triggers a failing background refresh
    await flushMicrotasks();

    expect(provider.get(MINT).marketCapUsd).toBe(9999);
  });

  it("re-fetches after the cache TTL expires", async () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse(),
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": goodActivitiesResponse(),
    });
    let now = 0;
    const provider = new SolscanTokenMetadataProvider("test-key", http, 1_000, () => now);

    await provider.prefetch(MINT);
    const callsAfterFirst = (http.fetchJson as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    now += 500;
    provider.get(MINT);
    await flushMicrotasks();
    expect((http.fetchJson as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst); // still fresh

    now += 2_000;
    provider.get(MINT); // stale - triggers a new background fetch
    await flushMicrotasks();
    expect((http.fetchJson as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("de-duplicates concurrent refreshes for the same mint", async () => {
    const http = fakeHttpClient({
      "/token/meta": goodMetaResponse(),
      "/token/holders": goodHoldersResponse(),
      "/account/defi/activities": goodActivitiesResponse(),
    });
    const provider = new SolscanTokenMetadataProvider("test-key", http, 20_000, () => 0);

    provider.get(MINT);
    provider.get(MINT);
    provider.get(MINT);
    await flushMicrotasks();

    const metaCalls = (http.fetchJson as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => (url as string).includes("/token/meta"));
    expect(metaCalls.length).toBe(1);
  });
});

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
