import type { Position, Signal, TokenStats } from "@whale-sniper/core";

export interface BucketStats {
  bucket: string;
  trades: number;
  wins: number;
  winRate: number;
  expectancyUsd: number;
  totalPnlUsd: number;
}

export interface BacktestReport {
  totalTrades: number;
  closedTrades: number;
  winRate: number;
  expectancyUsd: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalPnlUsd: number;
  byWallet: BucketStats[];
  bySignalStrength: BucketStats[];
  byTokenAge: BucketStats[];
  byLiquidity: BucketStats[];
  byMarketCap: BucketStats[];
}

function bucketStats(bucket: string, positions: Position[]): BucketStats {
  const wins = positions.filter((p) => p.realizedPnlUsd > 0).length;
  const totalPnlUsd = positions.reduce((s, p) => s + p.realizedPnlUsd, 0);
  return {
    bucket,
    trades: positions.length,
    wins,
    winRate: positions.length > 0 ? wins / positions.length : 0,
    expectancyUsd: positions.length > 0 ? totalPnlUsd / positions.length : 0,
    totalPnlUsd,
  };
}

function signalScoreBucket(score: number): string {
  if (score >= 85) return "85-100 (strong)";
  if (score >= 70) return "70-84 (moderate)";
  return "<70 (weak)";
}

function ageBucket(createdAt: number, entryBlockTimeApprox: number): string {
  const ageSeconds = Math.max(0, entryBlockTimeApprox - createdAt);
  if (ageSeconds < 3600) return "<1h old";
  if (ageSeconds < 86400) return "1h-1d old";
  return ">1d old";
}

function liquidityBucket(liquidityUsd: number): string {
  if (liquidityUsd < 10000) return "<$10k liquidity";
  if (liquidityUsd < 50000) return "$10k-$50k liquidity";
  return ">$50k liquidity";
}

function marketCapBucket(marketCapUsd: number): string {
  if (marketCapUsd < 50000) return "<$50k mcap";
  if (marketCapUsd < 250000) return "$50k-$250k mcap";
  return ">$250k mcap";
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = out.get(key) ?? [];
    arr.push(item);
    out.set(key, arr);
  }
  return out;
}

/**
 * Builds win rate / expectancy / profit factor / drawdown, broken down by
 * triggering wallet and by signal strength. Signals are joined in by
 * position.signalId so the signal-strength breakdown reflects the actual
 * score that gated each trade in.
 */
export function buildReport(
  positions: Position[],
  signals: Signal[],
  tokenStatsByMint: Map<string, TokenStats> = new Map(),
): BacktestReport {
  const closed = positions.filter((p) => p.status === "CLOSED");
  const signalById = new Map(signals.map((s) => [s.signalId, s]));

  const wins = closed.filter((p) => p.realizedPnlUsd > 0);
  const losses = closed.filter((p) => p.realizedPnlUsd <= 0);
  const grossProfit = wins.reduce((s, p) => s + p.realizedPnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p.realizedPnlUsd, 0));
  const totalPnlUsd = closed.reduce((s, p) => s + p.realizedPnlUsd, 0);

  let peak = 0;
  let equity = 0;
  let maxDrawdownPct = 0;
  const chronological = [...closed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  for (const p of chronological) {
    equity += p.realizedPnlUsd;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }

  const byWalletMap = groupBy(closed, (p) => p.whaleState.wallet);
  const byWallet = [...byWalletMap.entries()].map(([wallet, ps]) => bucketStats(wallet, ps));

  const bySignalStrengthMap = groupBy(closed, (p) => {
    const signal = signalById.get(p.signalId);
    return signalScoreBucket(signal?.score ?? 0);
  });
  const bySignalStrength = [...bySignalStrengthMap.entries()].map(([bucket, ps]) => bucketStats(bucket, ps));

  // Token age/liquidity/market cap "at entry" aren't stored on Position in
  // this scaffold, so this joins in whatever the token's *current* (as of
  // report time) stats are - a reasonable approximation for a scaffold's
  // reporting, but a real deployment would snapshot these onto the Position
  // at open time for a precise as-of-entry breakdown.
  const byTokenAgeMap = groupBy(closed, (p) => {
    const stats = tokenStatsByMint.get(p.tokenMint);
    return stats ? ageBucket(stats.createdAt, Math.floor(p.openedAt / 1000)) : "unknown";
  });
  const byTokenAge = [...byTokenAgeMap.entries()].map(([bucket, ps]) => bucketStats(bucket, ps));

  const byLiquidityMap = groupBy(closed, (p) => {
    const stats = tokenStatsByMint.get(p.tokenMint);
    return stats ? liquidityBucket(stats.liquidityUsd) : "unknown";
  });
  const byLiquidity = [...byLiquidityMap.entries()].map(([bucket, ps]) => bucketStats(bucket, ps));

  const byMarketCapMap = groupBy(closed, (p) => {
    const stats = tokenStatsByMint.get(p.tokenMint);
    return stats ? marketCapBucket(stats.marketCapUsd) : "unknown";
  });
  const byMarketCap = [...byMarketCapMap.entries()].map(([bucket, ps]) => bucketStats(bucket, ps));

  return {
    totalTrades: positions.length,
    closedTrades: closed.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    expectancyUsd: closed.length > 0 ? totalPnlUsd / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdownPct,
    totalPnlUsd,
    byWallet,
    bySignalStrength,
    byTokenAge,
    byLiquidity,
    byMarketCap,
  };
}

export function formatReport(report: BacktestReport): string {
  const lines: string[] = [];
  lines.push("=== Backtest Report ===");
  lines.push(`Total positions opened: ${report.totalTrades}`);
  lines.push(`Closed trades: ${report.closedTrades}`);
  lines.push(`Win rate: ${(report.winRate * 100).toFixed(1)}%`);
  lines.push(`Expectancy: $${report.expectancyUsd.toFixed(2)}/trade`);
  lines.push(`Profit factor: ${Number.isFinite(report.profitFactor) ? report.profitFactor.toFixed(2) : "inf"}`);
  lines.push(`Max drawdown: ${report.maxDrawdownPct.toFixed(1)}%`);
  lines.push(`Total PnL: $${report.totalPnlUsd.toFixed(2)}`);
  lines.push("");
  lines.push("By wallet:");
  for (const b of report.byWallet) {
    lines.push(`  ${b.bucket.slice(0, 12)}...  trades=${b.trades} winRate=${(b.winRate * 100).toFixed(0)}% pnl=$${b.totalPnlUsd.toFixed(2)}`);
  }
  lines.push("");
  lines.push("By signal strength:");
  for (const b of report.bySignalStrength) {
    lines.push(`  ${b.bucket}  trades=${b.trades} winRate=${(b.winRate * 100).toFixed(0)}% pnl=$${b.totalPnlUsd.toFixed(2)}`);
  }
  lines.push("");
  lines.push("By token age:");
  for (const b of report.byTokenAge) {
    lines.push(`  ${b.bucket}  trades=${b.trades} winRate=${(b.winRate * 100).toFixed(0)}% pnl=$${b.totalPnlUsd.toFixed(2)}`);
  }
  lines.push("");
  lines.push("By liquidity:");
  for (const b of report.byLiquidity) {
    lines.push(`  ${b.bucket}  trades=${b.trades} winRate=${(b.winRate * 100).toFixed(0)}% pnl=$${b.totalPnlUsd.toFixed(2)}`);
  }
  lines.push("");
  lines.push("By market cap:");
  for (const b of report.byMarketCap) {
    lines.push(`  ${b.bucket}  trades=${b.trades} winRate=${(b.winRate * 100).toFixed(0)}% pnl=$${b.totalPnlUsd.toFixed(2)}`);
  }
  return lines.join("\n");
}
