export type PositionStatus = "OPEN" | "CLOSED";

export type ExitReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "TRAILING_STOP"
  | "MAX_HOLD_TIME"
  | "WHALE_EXIT_EMERGENCY"
  | "MANUAL"
  | "KILL_SWITCH";

export interface TakeProfitLevel {
  triggerPct: number; // profit pct that triggers this level
  sellFraction: number; // fraction of the *original* position size to sell
  filled: boolean;
}

export interface PositionWhaleState {
  wallet: string;
  entryTxSignature: string;
  cumulativeSoldFraction: number;
  tier: "NONE" | "WARN" | "REDUCE" | "EMERGENCY";
  lastCheckedAt: number;
}

export interface Position {
  positionId: string;
  tokenMint: string;
  signalId: string;
  status: PositionStatus;
  entryPriceUsd: number;
  entryUsdValue: number;
  tokenAmount: number;
  remainingTokenAmount: number;
  currentPriceUsd: number;
  highWaterMarkPriceUsd: number;
  lowWaterMarkPriceUsd: number;
  stopLossPriceUsd: number;
  trailingStopPriceUsd?: number;
  trailingActive: boolean;
  takeProfitLevels: TakeProfitLevel[];
  whaleState: PositionWhaleState;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  mfePct: number; // max favorable excursion
  maePct: number; // max adverse excursion
  feesUsd: number;
  openedAt: number;
  closedAt?: number;
  exitReason?: ExitReason;
}
