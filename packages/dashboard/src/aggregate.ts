import { buildReport, type BacktestReport } from "@whale-sniper/backtest";
import type { Position, Signal, TokenStats, WalletScoreBreakdown } from "@whale-sniper/core";
import type { Repositories, WatchlistEntry } from "@whale-sniper/db";
import type { MetricsSnapshot } from "@whale-sniper/monitoring";
import type { RecentSignalEvent } from "./eventLog.js";

/** How many recent trades/signals a list endpoint returns by default -
 * generous enough to be useful on a live dashboard without shipping the
 * entire history over JSON on every 5s poll. */
const DEFAULT_LIST_LIMIT = 100;

async function loadTokenStatsByMint(repos: Repositories, positions: Position[]): Promise<Map<string, TokenStats>> {
  const mints = [...new Set(positions.map((p) => p.tokenMint))];
  const map = new Map<string, TokenStats>();
  for (const mint of mints) {
    const stats = await repos.token.getStats(mint);
    if (stats) map.set(mint, stats);
  }
  return map;
}

async function signalById(repos: Repositories, positions: Position[]): Promise<Map<string, Signal>> {
  const ids = [...new Set(positions.map((p) => p.signalId))];
  const map = new Map<string, Signal>();
  for (const id of ids) {
    const signal = await repos.signal.getSignal(id);
    if (signal) map.set(id, signal);
  }
  return map;
}

export interface DashboardOverview {
  report: BacktestReport;
  openPositionCount: number;
  totalPositionCount: number;
  avgWinUsd: number;
  avgLossUsd: number;
  watchlistCounts: { active: number; pending: number; rejected: number };
  feed: MetricsSnapshot["feed"];
  signalsGenerated: number;
  signalsRejected: number;
  ordersSubmitted: number;
  ordersFailed: number;
  ordersConfirmed: number;
  latencyMsByStage: MetricsSnapshot["latencyMsByStage"];
  currentEquityUsd: number;
  peakEquityUsd: number;
  drawdownPct: number;
}

/**
 * Reuses buildReport() from @whale-sniper/backtest unmodified for win
 * rate/expectancy/profit factor/drawdown - the dashboard only adds fields
 * that report doesn't already cover (avg win/loss USD, open position count,
 * watchlist counts, feed/latency health straight from MetricsStore).
 */
export async function buildOverview(repos: Repositories, metrics: MetricsSnapshot): Promise<DashboardOverview> {
  const positions = await repos.position.allPositions();
  // Large-but-bounded rather than Number.MAX_SAFE_INTEGER - the Prisma-backed
  // repository passes this straight through as `take`, which chokes on an
  // unbounded value; report-building only needs "effectively all" signals.
  const signals = await repos.signal.recentSignals(100_000);
  const tokenStatsByMint = await loadTokenStatsByMint(repos, positions);
  const report = buildReport(positions, signals, tokenStatsByMint);

  const closed = positions.filter((p) => p.status === "CLOSED");
  const wins = closed.filter((p) => p.realizedPnlUsd > 0);
  const losses = closed.filter((p) => p.realizedPnlUsd <= 0);
  const avgWinUsd = wins.length > 0 ? wins.reduce((s, p) => s + p.realizedPnlUsd, 0) / wins.length : 0;
  const avgLossUsd = losses.length > 0 ? losses.reduce((s, p) => s + p.realizedPnlUsd, 0) / losses.length : 0;

  const [active, pending, rejected] = await Promise.all([
    repos.watchlist.listByStatus("active"),
    repos.watchlist.listByStatus("pending"),
    repos.watchlist.listByStatus("rejected"),
  ]);

  return {
    report,
    openPositionCount: positions.filter((p) => p.status === "OPEN").length,
    totalPositionCount: positions.length,
    avgWinUsd,
    avgLossUsd,
    watchlistCounts: { active: active.length, pending: pending.length, rejected: rejected.length },
    feed: metrics.feed,
    signalsGenerated: metrics.signalsGenerated,
    signalsRejected: metrics.signalsRejected,
    ordersSubmitted: metrics.ordersSubmitted,
    ordersFailed: metrics.ordersFailed,
    ordersConfirmed: metrics.ordersConfirmed,
    latencyMsByStage: metrics.latencyMsByStage,
    currentEquityUsd: metrics.currentEquityUsd,
    peakEquityUsd: metrics.peakEquityUsd,
    drawdownPct: metrics.drawdownPct,
  };
}

export interface TradeRow {
  positionId: string;
  tokenMint: string;
  wallet: string;
  status: Position["status"];
  entryPriceUsd: number;
  entryUsdValue: number;
  currentPriceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  signalScore?: number;
  openedAt: number;
  closedAt?: number;
  exitReason?: Position["exitReason"];
}

function toTradeRow(position: Position, signal: Signal | undefined): TradeRow {
  return {
    positionId: position.positionId,
    tokenMint: position.tokenMint,
    wallet: position.whaleState.wallet,
    status: position.status,
    entryPriceUsd: position.entryPriceUsd,
    entryUsdValue: position.entryUsdValue,
    currentPriceUsd: position.currentPriceUsd,
    realizedPnlUsd: position.realizedPnlUsd,
    unrealizedPnlUsd: position.unrealizedPnlUsd,
    signalScore: signal?.score,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
    exitReason: position.exitReason,
  };
}

/** Most recent first, newest-opened-first ordering (matches what an
 * operator scanning a live feed wants to see at the top). */
export async function buildTradesList(repos: Repositories, limit = DEFAULT_LIST_LIMIT): Promise<TradeRow[]> {
  const positions = await repos.position.allPositions();
  const signals = await signalById(repos, positions);
  return positions
    .slice()
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, limit)
    .map((p) => toTradeRow(p, signals.get(p.signalId)));
}

export async function buildOpenPositions(repos: Repositories): Promise<TradeRow[]> {
  const positions = await repos.position.getOpenPositions();
  const signals = await signalById(repos, positions);
  return positions
    .slice()
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((p) => toTradeRow(p, signals.get(p.signalId)));
}

export interface WhaleRow {
  address: string;
  label?: string;
  status: WatchlistEntry["status"];
  source: WatchlistEntry["source"];
  whaleScore?: number;
  passedHardGate?: boolean;
  tradeCount: number;
  openTradeCount: number;
  realizedPnlUsd: number;
}

/** Joins the watchlist against per-wallet score + this wallet's positions -
 * Position.whaleState.wallet is the triggering whale directly, so no need
 * to go through Signal.triggeringWallet for the whale->trade linkage. */
export async function buildWhalesList(repos: Repositories): Promise<WhaleRow[]> {
  const entries = await repos.watchlist.load();
  const positions = await repos.position.allPositions();

  const rows: WhaleRow[] = [];
  for (const entry of entries) {
    const score = await repos.wallet.getScore(entry.address);
    const walletPositions = positions.filter((p) => p.whaleState.wallet === entry.address);
    rows.push({
      address: entry.address,
      label: entry.label,
      status: entry.status,
      source: entry.source,
      whaleScore: score?.whaleScore,
      passedHardGate: score?.passedHardGate,
      tradeCount: walletPositions.length,
      openTradeCount: walletPositions.filter((p) => p.status === "OPEN").length,
      realizedPnlUsd: walletPositions.reduce((s, p) => s + p.realizedPnlUsd, 0),
    });
  }
  return rows.sort((a, b) => (b.whaleScore ?? -1) - (a.whaleScore ?? -1));
}

export interface WhaleDetail {
  address: string;
  entry?: WatchlistEntry;
  score?: WalletScoreBreakdown;
  trades: TradeRow[];
}

export async function buildWhaleDetail(repos: Repositories, address: string): Promise<WhaleDetail> {
  const [entries, score, positions] = await Promise.all([
    repos.watchlist.load(),
    repos.wallet.getScore(address),
    repos.position.allPositions(),
  ]);
  const entry = entries.find((e) => e.address === address);
  const walletPositions = positions.filter((p) => p.whaleState.wallet === address);
  const signals = await signalById(repos, walletPositions);
  const trades = walletPositions
    .slice()
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((p) => toTradeRow(p, signals.get(p.signalId)));

  return { address, entry, score, trades };
}

export interface CandidateRow {
  address: string;
  label?: string;
  notes?: string;
  whaleScore?: number;
  passedHardGate?: boolean;
}

/** whale-discovery candidates awaiting operator review (via Telegram's
 * /approve, /reject - this dashboard is read-only, no action here). */
export async function buildCandidatesList(repos: Repositories): Promise<CandidateRow[]> {
  const pending = await repos.watchlist.listByStatus("pending");
  const rows: CandidateRow[] = [];
  for (const entry of pending) {
    const score = await repos.wallet.getScore(entry.address);
    rows.push({
      address: entry.address,
      label: entry.label,
      notes: entry.notes,
      whaleScore: score?.whaleScore,
      passedHardGate: score?.passedHardGate,
    });
  }
  return rows.sort((a, b) => (b.whaleScore ?? -1) - (a.whaleScore ?? -1));
}

export function buildSignalsList(eventLogEvents: RecentSignalEvent[], limit = DEFAULT_LIST_LIMIT): RecentSignalEvent[] {
  return eventLogEvents.slice(0, limit);
}
