import { createServer, type Server } from "node:http";
import type { Position, Signal } from "@whale-sniper/core";
import {
  RecentEventLog,
  handleDashboardRequest,
  type CandidateRow,
  type DashboardOverview,
  type TradeRow,
  type WhaleDetail,
  type WhaleRow,
} from "@whale-sniper/dashboard";
import { createInMemoryRepositories, type Repositories } from "@whale-sniper/db";
import { MetricsStore } from "@whale-sniper/monitoring";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function signal(): Signal {
  return {
    signalId: "sig-1",
    tokenMint: "TOKEN1",
    triggeringWallet: "WHALE1",
    triggeringTxSignature: "tx1",
    components: {
      whaleQuality: 80,
      tokenQuality: 80,
      liquidity: 80,
      buyingMomentum: 80,
      independentBuyers: 80,
      earlyEntryQuality: 80,
      manipulationPenalty: 0,
    },
    score: 91,
    generatedAt: Date.now(),
  };
}

function position(): Position {
  return {
    positionId: "pos-1",
    tokenMint: "TOKEN1",
    signalId: "sig-1",
    status: "CLOSED",
    entryPriceUsd: 1,
    entryUsdValue: 500,
    tokenAmount: 500,
    remainingTokenAmount: 0,
    currentPriceUsd: 1.5,
    highWaterMarkPriceUsd: 1.6,
    lowWaterMarkPriceUsd: 0.9,
    stopLossPriceUsd: 0.8,
    trailingActive: false,
    takeProfitLevels: [],
    whaleState: {
      wallet: "WHALE1",
      entryTxSignature: "tx1",
      cumulativeSoldFraction: 0,
      tier: "NONE",
      lastCheckedAt: Date.now(),
    },
    realizedPnlUsd: 250,
    unrealizedPnlUsd: 0,
    mfePct: 0.6,
    maePct: -0.1,
    feesUsd: 2,
    openedAt: Date.now() - 60_000,
    closedAt: Date.now(),
    exitReason: "TAKE_PROFIT",
  };
}

describe("dashboard HTTP routes (mounted the same way healthServer.ts mounts them)", () => {
  let server: Server;
  let baseUrl: string;
  let repos: Repositories;

  beforeAll(async () => {
    repos = createInMemoryRepositories();
    await repos.signal.saveSignal(signal());
    await repos.position.savePosition(position());
    await repos.watchlist.add({ address: "WHALE1", label: "Whale One", status: "active", source: "manual" });
    await repos.watchlist.add({ address: "WHALE2", status: "pending", source: "auto-discovered" });

    const metrics = new MetricsStore();
    const eventLog = new RecentEventLog();
    eventLog.start(new (await import("@whale-sniper/core")).EventBus());

    server = createServer((req, res) => {
      void handleDashboardRequest(req, res, { repos, metrics, eventLog }).then((handled) => {
        if (!handled) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a bound TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("GET /api/overview returns a report built from the seeded position/signal", async () => {
    const res = await fetch(`${baseUrl}/api/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardOverview;
    expect(body.report.closedTrades).toBe(1);
    expect(body.report.winRate).toBe(1);
    expect(body.watchlistCounts).toEqual({ active: 1, pending: 1, rejected: 0 });
  });

  it("GET /api/trades returns the seeded trade joined to its signal score", async () => {
    const res = await fetch(`${baseUrl}/api/trades`);
    const body = (await res.json()) as TradeRow[];
    expect(body).toHaveLength(1);
    expect(body[0].positionId).toBe("pos-1");
    expect(body[0].signalScore).toBe(91);
  });

  it("GET /api/whales returns the watchlist joined to whale trade stats", async () => {
    const res = await fetch(`${baseUrl}/api/whales`);
    const body = (await res.json()) as WhaleRow[];
    expect(body).toHaveLength(2);
  });

  it("GET /api/whales/:address returns one whale's detail", async () => {
    const res = await fetch(`${baseUrl}/api/whales/WHALE1`);
    const body = (await res.json()) as WhaleDetail;
    expect(body.address).toBe("WHALE1");
    expect(body.trades).toHaveLength(1);
  });

  it("GET /api/candidates returns only pending watchlist entries", async () => {
    const res = await fetch(`${baseUrl}/api/candidates`);
    const body = (await res.json()) as CandidateRow[];
    expect(body).toHaveLength(1);
    expect(body[0].address).toBe("WHALE2");
  });

  it("GET /api/signals returns 200 with an empty list when nothing has fired yet", async () => {
    const res = await fetch(`${baseUrl}/api/signals`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("GET / serves the dashboard HTML shell", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<title>");
  });

  it("GET /nonsense falls through to 404, same as before the dashboard was mounted", async () => {
    const res = await fetch(`${baseUrl}/nonsense`);
    expect(res.status).toBe(404);
  });
});
