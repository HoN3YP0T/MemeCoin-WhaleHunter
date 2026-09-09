import {
  newId,
  type NormalizedTradeEvent,
  type Signal,
  type SignalComponents,
  type StrategyConfig,
  type TokenRiskScore,
  type TokenStats,
  type WalletCluster,
  type WalletScoreBreakdown,
} from "@whale-sniper/core";

const TARGET_LIQUIDITY_USD = 50_000;
const TARGET_INDEPENDENT_BUYERS = 10;
const EARLY_ENTRY_QUALITY_WINDOW_SECONDS = 600;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface SignalInputs {
  triggeringTrade: NormalizedTradeEvent;
  walletScore: WalletScoreBreakdown;
  tokenRisk: TokenRiskScore;
  tokenStats: TokenStats;
  tokenFirstSeenBlockTime: number;
  cluster?: WalletCluster;
}

export function computeSignalComponents(input: SignalInputs): SignalComponents {
  const whaleQuality = Math.max(0, Math.min(100, input.walletScore.whaleScore));
  const tokenQuality = Math.max(0, Math.min(100, 100 - input.tokenRisk.riskScore));
  const liquidity = clamp01(input.tokenStats.liquidityUsd / TARGET_LIQUIDITY_USD) * 100;

  const totalVol5m = input.tokenStats.buyVolumeUsd5m + input.tokenStats.sellVolumeUsd5m;
  const momentumRatio = totalVol5m > 0 ? input.tokenStats.buyVolumeUsd5m / totalVol5m : 0.5;
  const buyingMomentum = clamp01(momentumRatio) * 100;

  const independentBuyers = clamp01(input.tokenStats.uniqueBuyers1h / TARGET_INDEPENDENT_BUYERS) * 100;

  const secondsSinceLaunch = Math.max(0, input.triggeringTrade.blockTime - input.tokenFirstSeenBlockTime);
  const earlyEntryQuality = clamp01(1 - secondsSinceLaunch / EARLY_ENTRY_QUALITY_WINDOW_SECONDS) * 100;

  const manipulationPenalty = input.cluster?.manipulationPenalty ?? 0;

  return { whaleQuality, tokenQuality, liquidity, buyingMomentum, independentBuyers, earlyEntryQuality, manipulationPenalty };
}

export function computeSignal(input: SignalInputs, config: StrategyConfig): Signal {
  const components = computeSignalComponents(input);
  const w = config.signalWeights;

  const rawScore =
    w.whaleQuality * components.whaleQuality +
    w.tokenQuality * components.tokenQuality +
    w.liquidity * components.liquidity +
    w.buyingMomentum * components.buyingMomentum +
    w.independentBuyers * components.independentBuyers +
    w.earlyEntryQuality * components.earlyEntryQuality -
    w.manipulationPenalty * components.manipulationPenalty;

  const score = Math.max(0, Math.min(100, rawScore));

  return {
    signalId: newId("signal"),
    tokenMint: input.triggeringTrade.tokenMint,
    triggeringWallet: input.triggeringTrade.wallet,
    triggeringTxSignature: input.triggeringTrade.txSignature,
    components,
    score,
    generatedAt: Date.now(),
  };
}
