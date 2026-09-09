import { markPositionPrice, type ExitResult } from "@whale-sniper/paper-trading";
import type { ExitReason, Position, StrategyConfig } from "@whale-sniper/core";

export type PositionTickOutcome =
  | { kind: "NO_ACTION" }
  | { kind: "PARTIAL_EXIT"; sellFraction: number; reason: ExitReason; triggerPct: number }
  | { kind: "FULL_EXIT"; reason: ExitReason };

function roiPct(position: Position): number {
  return ((position.currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
}

/**
 * Decides the *next* action for a position at a given price tick. Only one
 * outcome is returned per call - callers should keep calling tick until
 * NO_ACTION so multiple TP levels crossed in a single big price jump are
 * each applied (and logged) as separate fills, exactly like a real ladder
 * would fire as separate on-chain sells.
 */
export function decideNextAction(position: Position, config: StrategyConfig, nowMs: number): PositionTickOutcome {
  if (position.status === "CLOSED") return { kind: "NO_ACTION" };

  const roi = roiPct(position);

  const heldMs = nowMs - position.openedAt;
  if (heldMs >= config.position.maxHoldTimeSeconds * 1000) {
    return { kind: "FULL_EXIT", reason: "MAX_HOLD_TIME" };
  }

  if (position.trailingActive && position.trailingStopPriceUsd !== undefined) {
    if (position.currentPriceUsd <= position.trailingStopPriceUsd) {
      return { kind: "FULL_EXIT", reason: "TRAILING_STOP" };
    }
  } else if (position.currentPriceUsd <= position.stopLossPriceUsd) {
    return { kind: "FULL_EXIT", reason: "STOP_LOSS" };
  }

  const nextLevel = position.takeProfitLevels.find((l) => !l.filled && roi >= l.triggerPct);
  if (nextLevel) {
    // sellFraction is defined against the *original* size; convert to a
    // fraction of what's currently remaining so applyPaperExit's
    // remainingTokenAmount math stays correct.
    const originalTokens = position.tokenAmount;
    const targetTokensToSell = originalTokens * nextLevel.sellFraction;
    const fractionOfRemaining = position.remainingTokenAmount > 0 ? Math.min(1, targetTokensToSell / position.remainingTokenAmount) : 0;
    return { kind: "PARTIAL_EXIT", sellFraction: fractionOfRemaining, reason: "TAKE_PROFIT", triggerPct: nextLevel.triggerPct };
  }

  if (!position.trailingActive && roi >= config.position.trailingActivationPct) {
    return { kind: "NO_ACTION" }; // activation handled by applyPriceTick before this is reached
  }

  return { kind: "NO_ACTION" };
}

/** Updates price bookkeeping and trailing-stop state in place. Call this
 * before decideNextAction on every tick. */
export function applyPriceTick(position: Position, priceUsd: number, config: StrategyConfig): void {
  markPositionPrice(position, priceUsd);
  const roi = roiPct(position);

  if (!position.trailingActive && roi >= config.position.trailingActivationPct) {
    position.trailingActive = true;
  }
  if (position.trailingActive) {
    const candidateStop = position.highWaterMarkPriceUsd * (1 - config.position.trailingTrailPct / 100);
    position.trailingStopPriceUsd = Math.max(position.trailingStopPriceUsd ?? 0, candidateStop);
  }
}

export function markTakeProfitFilled(position: Position, triggerPct: number): void {
  const level = position.takeProfitLevels.find((l) => l.triggerPct === triggerPct);
  if (level) level.filled = true;
}

export interface PositionTickResult {
  position: Position;
  exitResults: Array<{ outcome: PositionTickOutcome; exit: ExitResult }>;
}
