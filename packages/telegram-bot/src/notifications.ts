import type { Position, Signal, WalletScoreBreakdown } from "@whale-sniper/core";

// Notification templates deliberately use emoji, matching the spec's own
// examples - the one place in this codebase emoji are intentional.

export function formatWhaleDetected(wallet: string, tokenMint: string, usdValue: number, whaleScore: WalletScoreBreakdown): string {
  return [
    `🐋 Whale buy detected`,
    `Wallet: ${short(wallet)} (score ${whaleScore.whaleScore.toFixed(0)}/100)`,
    `Token: ${short(tokenMint)}`,
    `Size: $${usdValue.toFixed(0)}`,
  ].join("\n");
}

export function formatEntry(position: Position, signal: Signal): string {
  return [
    `🟢 Entered position`,
    `Token: ${short(position.tokenMint)}`,
    `Entry: $${position.entryPriceUsd.toFixed(6)} | Size: $${position.entryUsdValue.toFixed(0)}`,
    `Signal score: ${signal.score.toFixed(1)}/100`,
    `Stop loss: $${position.stopLossPriceUsd.toFixed(6)}`,
  ].join("\n");
}

export function formatExit(position: Position): string {
  const pnl = position.realizedPnlUsd;
  const emoji = pnl >= 0 ? "🟢" : "🔴";
  return [
    `${emoji} Closed position`,
    `Token: ${short(position.tokenMint)}`,
    `Reason: ${position.exitReason ?? "unknown"}`,
    `Realized PnL: $${pnl.toFixed(2)}`,
    `MFE: ${position.mfePct.toFixed(1)}% | MAE: ${position.maePct.toFixed(1)}%`,
  ].join("\n");
}

export function formatWhaleExit(wallet: string, tokenMint: string, pctSold: number): string {
  return `🐋⚠️ Triggering whale ${short(wallet)} has sold ${(pctSold * 100).toFixed(0)}% of their position in ${short(tokenMint)}`;
}

export function formatSignalRejected(tokenMint: string, reason: string): string {
  return `⛔ Signal rejected for ${short(tokenMint)}: ${reason}`;
}

function short(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}
