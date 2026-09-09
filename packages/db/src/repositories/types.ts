import type {
  CreatorReputation,
  NormalizedTradeEvent,
  Position,
  Signal,
  TokenRiskScore,
  TokenStats,
  WalletCluster,
  WalletScoreBreakdown,
  WalletStats,
} from "@whale-sniper/core";

export interface WatchlistEntry {
  address: string;
  label?: string;
  notes?: string;
}

export interface RiskState {
  dailyLossUsd: number;
  dailyLossResetAt: number;
  consecutiveLosses: number;
  cooldownUntil?: number;
  killSwitchActive: boolean;
}

/** Every repository is defined as a plain interface so packages depend on
 * behavior, not on Prisma directly - unit tests use in-memory
 * implementations, the live app uses the Prisma-backed ones. */
export interface IWalletRepository {
  upsertStats(stats: WalletStats): Promise<void>;
  getStats(wallet: string): Promise<WalletStats | undefined>;
  upsertScore(score: WalletScoreBreakdown): Promise<void>;
  getScore(wallet: string): Promise<WalletScoreBreakdown | undefined>;
}

export interface ITokenRepository {
  upsertStats(stats: TokenStats): Promise<void>;
  getStats(tokenMint: string): Promise<TokenStats | undefined>;
  upsertRiskScore(score: TokenRiskScore): Promise<void>;
  getRiskScore(tokenMint: string): Promise<TokenRiskScore | undefined>;
}

export interface ITradeRepository {
  recordTrade(event: NormalizedTradeEvent): Promise<void>;
  tradesForWallet(wallet: string): Promise<NormalizedTradeEvent[]>;
}

export interface IClusterRepository {
  upsertCluster(cluster: WalletCluster): Promise<void>;
  getCluster(clusterId: string): Promise<WalletCluster | undefined>;
}

export interface ISignalRepository {
  saveSignal(signal: Signal): Promise<void>;
  getSignal(signalId: string): Promise<Signal | undefined>;
  recentSignals(limit: number): Promise<Signal[]>;
}

export interface IPositionRepository {
  savePosition(position: Position): Promise<void>;
  getPosition(positionId: string): Promise<Position | undefined>;
  getOpenPositions(): Promise<Position[]>;
  allPositions(): Promise<Position[]>;
}

export interface IWatchlistRepository {
  load(): Promise<WatchlistEntry[]>;
  add(entry: WatchlistEntry): Promise<void>;
}

export interface IRiskStateRepository {
  get(): Promise<RiskState>;
  update(partial: Partial<RiskState>): Promise<RiskState>;
}

/** Persists `CreatorRegistry`'s reputation map so it survives restarts -
 * hydrated at boot, upserted on every observed/rugged update. */
export interface ICreatorRegistryRepository {
  upsertReputation(reputation: CreatorReputation): Promise<void>;
  loadAll(): Promise<CreatorReputation[]>;
}

export interface Repositories {
  wallet: IWalletRepository;
  token: ITokenRepository;
  trade: ITradeRepository;
  cluster: IClusterRepository;
  signal: ISignalRepository;
  position: IPositionRepository;
  watchlist: IWatchlistRepository;
  riskState: IRiskStateRepository;
  creatorReputation: ICreatorRegistryRepository;
}
