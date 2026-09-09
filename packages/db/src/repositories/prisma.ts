import { riskBand, type NormalizedTradeEvent, type Position, type Signal, type TokenRiskScore, type TokenStats, type WalletCluster, type WalletScoreBreakdown, type WalletStats } from "@whale-sniper/core";
import type {
  IClusterRepository,
  IPositionRepository,
  IRiskStateRepository,
  ISignalRepository,
  ITokenRepository,
  ITradeRepository,
  IWalletRepository,
  IWatchlistRepository,
  Repositories,
  RiskState,
  WatchlistEntry,
} from "./types.js";

/** Thin adapters over a generated PrismaClient. `prisma` is typed `any`
 * because the generated types only exist after `prisma generate` runs. */
export class PrismaWalletRepository implements IWalletRepository {
  constructor(private readonly prisma: any) {}

  async upsertStats(stats: WalletStats): Promise<void> {
    await this.prisma.wallet.upsert({
      where: { address: stats.wallet },
      create: {
        address: stats.wallet,
        tradeCount: stats.tradeCount,
        winCount: stats.winCount,
        lossCount: stats.lossCount,
        winRate: stats.winRate,
        realizedPnlUsd: stats.realizedPnlUsd,
        avgRoiPct: stats.avgRoiPct,
        maxDrawdownPct: stats.maxDrawdownPct,
        avgWhaleBuySizeUsd: stats.avgWhaleBuySizeUsd,
        earlyEntryFrequency: stats.earlyEntryFrequency,
        rugExposureCount: stats.rugExposureCount,
        firstTradeAt: new Date(stats.firstTradeAt),
        lastTradeAt: new Date(stats.lastTradeAt),
      },
      update: {
        tradeCount: stats.tradeCount,
        winCount: stats.winCount,
        lossCount: stats.lossCount,
        winRate: stats.winRate,
        realizedPnlUsd: stats.realizedPnlUsd,
        avgRoiPct: stats.avgRoiPct,
        maxDrawdownPct: stats.maxDrawdownPct,
        avgWhaleBuySizeUsd: stats.avgWhaleBuySizeUsd,
        earlyEntryFrequency: stats.earlyEntryFrequency,
        rugExposureCount: stats.rugExposureCount,
        lastTradeAt: new Date(stats.lastTradeAt),
      },
    });
  }

  async getStats(wallet: string): Promise<WalletStats | undefined> {
    const row = await this.prisma.wallet.findUnique({ where: { address: wallet } });
    if (!row) return undefined;
    return {
      wallet: row.address,
      tradeCount: row.tradeCount,
      winCount: row.winCount,
      lossCount: row.lossCount,
      winRate: row.winRate,
      realizedPnlUsd: row.realizedPnlUsd,
      avgRoiPct: row.avgRoiPct,
      maxDrawdownPct: row.maxDrawdownPct,
      avgWhaleBuySizeUsd: row.avgWhaleBuySizeUsd,
      earlyEntryFrequency: row.earlyEntryFrequency,
      rugExposureCount: row.rugExposureCount,
      firstTradeAt: row.firstTradeAt ? row.firstTradeAt.getTime() : 0,
      lastTradeAt: row.lastTradeAt ? row.lastTradeAt.getTime() : 0,
    };
  }

  async upsertScore(score: WalletScoreBreakdown): Promise<void> {
    await this.prisma.walletScore.create({
      data: {
        walletAddress: score.wallet,
        consistency: score.consistency,
        timing: score.timing,
        selectivity: score.selectivity,
        exitQuality: score.exitQuality,
        rugAvoidance: score.rugAvoidance,
        recentPerformance: score.recentPerformance,
        whaleScore: score.whaleScore,
        passedHardGate: score.passedHardGate,
        gateFailureReasons: score.gateFailureReasons,
      },
    });
  }

  async getScore(wallet: string): Promise<WalletScoreBreakdown | undefined> {
    const row = await this.prisma.walletScore.findFirst({
      where: { walletAddress: wallet },
      orderBy: { computedAt: "desc" },
    });
    if (!row) return undefined;
    return {
      wallet: row.walletAddress,
      consistency: row.consistency,
      timing: row.timing,
      selectivity: row.selectivity,
      exitQuality: row.exitQuality,
      rugAvoidance: row.rugAvoidance,
      recentPerformance: row.recentPerformance,
      whaleScore: row.whaleScore,
      passedHardGate: row.passedHardGate,
      gateFailureReasons: row.gateFailureReasons,
      computedAt: row.computedAt.getTime(),
    };
  }
}

export class PrismaTokenRepository implements ITokenRepository {
  constructor(private readonly prisma: any) {}

  async upsertStats(stats: TokenStats): Promise<void> {
    await this.prisma.token.upsert({
      where: { mint: stats.tokenMint },
      create: {
        mint: stats.tokenMint,
        liquidityUsd: stats.liquidityUsd,
        marketCapUsd: stats.marketCapUsd,
        holderCount: stats.holderCount,
        top10HolderPct: stats.top10HolderPct,
        mintAuthorityRevoked: stats.mintAuthorityRevoked,
        freezeAuthorityRevoked: stats.freezeAuthorityRevoked,
      },
      update: {
        liquidityUsd: stats.liquidityUsd,
        marketCapUsd: stats.marketCapUsd,
        holderCount: stats.holderCount,
        top10HolderPct: stats.top10HolderPct,
        mintAuthorityRevoked: stats.mintAuthorityRevoked,
        freezeAuthorityRevoked: stats.freezeAuthorityRevoked,
      },
    });
  }

  async getStats(tokenMint: string): Promise<TokenStats | undefined> {
    const row = await this.prisma.token.findUnique({ where: { mint: tokenMint } });
    if (!row) return undefined;
    return {
      tokenMint: row.mint,
      createdAt: Math.floor(row.createdAt.getTime() / 1000),
      liquidityUsd: row.liquidityUsd,
      marketCapUsd: row.marketCapUsd,
      holderCount: row.holderCount,
      top10HolderPct: row.top10HolderPct,
      mintAuthorityRevoked: row.mintAuthorityRevoked,
      freezeAuthorityRevoked: row.freezeAuthorityRevoked,
      uniqueBuyers1h: 0,
      uniqueSellers1h: 0,
      buyVolumeUsd5m: 0,
      sellVolumeUsd5m: 0,
      buyVolumeUsd1h: 0,
      sellVolumeUsd1h: 0,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async upsertRiskScore(score: TokenRiskScore): Promise<void> {
    await this.prisma.tokenRiskScoreRow.create({
      data: {
        tokenMint: score.tokenMint,
        ageRisk: score.ageRisk,
        liquidityRisk: score.liquidityRisk,
        concentrationRisk: score.concentrationRisk,
        authorityRisk: score.authorityRisk,
        buyerDiversityRisk: score.buyerDiversityRisk,
        flowRisk: score.flowRisk,
        riskScore: score.riskScore,
        band: score.band,
      },
    });
  }

  async getRiskScore(tokenMint: string): Promise<TokenRiskScore | undefined> {
    const row = await this.prisma.tokenRiskScoreRow.findFirst({
      where: { tokenMint },
      orderBy: { computedAt: "desc" },
    });
    if (!row) return undefined;
    return {
      tokenMint: row.tokenMint,
      ageRisk: row.ageRisk,
      liquidityRisk: row.liquidityRisk,
      concentrationRisk: row.concentrationRisk,
      authorityRisk: row.authorityRisk,
      buyerDiversityRisk: row.buyerDiversityRisk,
      flowRisk: row.flowRisk,
      riskScore: row.riskScore,
      band: riskBand(row.riskScore),
      computedAt: row.computedAt.getTime(),
    };
  }
}

export class PrismaTradeRepository implements ITradeRepository {
  constructor(private readonly prisma: any) {}

  async recordTrade(event: NormalizedTradeEvent): Promise<void> {
    await this.prisma.trade.upsert({
      where: { txSignature: event.txSignature },
      create: {
        txSignature: event.txSignature,
        walletAddress: event.wallet,
        tokenMint: event.tokenMint,
        side: event.side,
        tokenAmount: event.tokenAmount,
        usdValue: event.usdValue,
        priceUsd: event.priceUsd,
        dex: event.dex,
        pool: event.pool,
        slot: event.slot,
        blockTime: new Date(event.blockTime * 1000),
      },
      update: {},
    });
  }

  async tradesForWallet(wallet: string): Promise<NormalizedTradeEvent[]> {
    const rows = await this.prisma.trade.findMany({ where: { walletAddress: wallet } });
    return rows.map((row: any) => ({
      id: row.id,
      wallet: row.walletAddress,
      tokenMint: row.tokenMint,
      side: row.side,
      tokenAmount: row.tokenAmount,
      usdValue: row.usdValue,
      priceUsd: row.priceUsd,
      dex: row.dex,
      pool: row.pool,
      slot: row.slot,
      blockTime: Math.floor(row.blockTime.getTime() / 1000),
      txSignature: row.txSignature,
      timestamps: { rawReceivedAt: row.createdAt.getTime() },
    }));
  }
}

export class PrismaClusterRepository implements IClusterRepository {
  constructor(private readonly prisma: any) {}

  async upsertCluster(cluster: WalletCluster): Promise<void> {
    await this.prisma.cluster.upsert({
      where: { clusterKey: cluster.clusterId },
      create: {
        clusterKey: cluster.clusterId,
        tokenMint: cluster.tokenMint,
        members: cluster.members,
        edges: cluster.edges as any,
        concentratedOwnership: cluster.flags.concentratedOwnership,
        coordinatedBuying: cluster.flags.coordinatedBuying,
        immediateLargeSelling: cluster.flags.immediateLargeSelling,
        creatorAssociatedWallets: cluster.flags.creatorAssociatedWallets,
        suspiciousLiquidityBehavior: cluster.flags.suspiciousLiquidityBehavior,
        manipulationPenalty: cluster.manipulationPenalty,
      },
      update: {
        members: cluster.members,
        edges: cluster.edges as any,
        concentratedOwnership: cluster.flags.concentratedOwnership,
        coordinatedBuying: cluster.flags.coordinatedBuying,
        immediateLargeSelling: cluster.flags.immediateLargeSelling,
        creatorAssociatedWallets: cluster.flags.creatorAssociatedWallets,
        suspiciousLiquidityBehavior: cluster.flags.suspiciousLiquidityBehavior,
        manipulationPenalty: cluster.manipulationPenalty,
      },
    });
  }

  async getCluster(clusterId: string): Promise<WalletCluster | undefined> {
    const row = await this.prisma.cluster.findUnique({ where: { clusterKey: clusterId } });
    if (!row) return undefined;
    return {
      clusterId: row.clusterKey,
      members: row.members,
      edges: row.edges as any,
      tokenMint: row.tokenMint ?? undefined,
      flags: {
        concentratedOwnership: row.concentratedOwnership,
        coordinatedBuying: row.coordinatedBuying,
        immediateLargeSelling: row.immediateLargeSelling,
        creatorAssociatedWallets: row.creatorAssociatedWallets,
        suspiciousLiquidityBehavior: row.suspiciousLiquidityBehavior,
      },
      manipulationPenalty: row.manipulationPenalty,
      computedAt: row.computedAt.getTime(),
    };
  }
}

export class PrismaSignalRepository implements ISignalRepository {
  constructor(private readonly prisma: any) {}

  async saveSignal(signal: Signal): Promise<void> {
    await this.prisma.signal.upsert({
      where: { signalKey: signal.signalId },
      create: {
        signalKey: signal.signalId,
        tokenMint: signal.tokenMint,
        triggeringWallet: signal.triggeringWallet,
        triggeringTxSignature: signal.triggeringTxSignature,
        whaleQuality: signal.components.whaleQuality,
        tokenQuality: signal.components.tokenQuality,
        liquidity: signal.components.liquidity,
        buyingMomentum: signal.components.buyingMomentum,
        independentBuyers: signal.components.independentBuyers,
        earlyEntryQuality: signal.components.earlyEntryQuality,
        manipulationPenalty: signal.components.manipulationPenalty,
        score: signal.score,
      },
      update: {},
    });
  }

  async getSignal(signalId: string): Promise<Signal | undefined> {
    const row = await this.prisma.signal.findUnique({ where: { signalKey: signalId } });
    if (!row) return undefined;
    return rowToSignal(row);
  }

  async recentSignals(limit: number): Promise<Signal[]> {
    const rows = await this.prisma.signal.findMany({ orderBy: { generatedAt: "desc" }, take: limit });
    return rows.map(rowToSignal);
  }
}

function rowToSignal(row: any): Signal {
  return {
    signalId: row.signalKey,
    tokenMint: row.tokenMint,
    triggeringWallet: row.triggeringWallet,
    triggeringTxSignature: row.triggeringTxSignature,
    components: {
      whaleQuality: row.whaleQuality,
      tokenQuality: row.tokenQuality,
      liquidity: row.liquidity,
      buyingMomentum: row.buyingMomentum,
      independentBuyers: row.independentBuyers,
      earlyEntryQuality: row.earlyEntryQuality,
      manipulationPenalty: row.manipulationPenalty,
    },
    score: row.score,
    generatedAt: row.generatedAt.getTime(),
  };
}

export class PrismaPositionRepository implements IPositionRepository {
  constructor(private readonly prisma: any) {}

  async savePosition(position: Position): Promise<void> {
    await this.prisma.position.upsert({
      where: { positionKey: position.positionId },
      create: {
        positionKey: position.positionId,
        tokenMint: position.tokenMint,
        signalId: position.signalId,
        walletAddress: position.whaleState.wallet,
        status: position.status,
        entryPriceUsd: position.entryPriceUsd,
        entryUsdValue: position.entryUsdValue,
        tokenAmount: position.tokenAmount,
        remainingTokenAmount: position.remainingTokenAmount,
        realizedPnlUsd: position.realizedPnlUsd,
        feesUsd: position.feesUsd,
        mfePct: position.mfePct,
        maePct: position.maePct,
        exitReason: position.exitReason,
        closedAt: position.closedAt ? new Date(position.closedAt) : undefined,
      },
      update: {
        status: position.status,
        remainingTokenAmount: position.remainingTokenAmount,
        realizedPnlUsd: position.realizedPnlUsd,
        feesUsd: position.feesUsd,
        mfePct: position.mfePct,
        maePct: position.maePct,
        exitReason: position.exitReason,
        closedAt: position.closedAt ? new Date(position.closedAt) : undefined,
      },
    });
  }

  async getPosition(): Promise<Position | undefined> {
    // Position reconstruction from relational rows is intentionally not
    // supported - the live app keeps full Position objects in memory
    // (position-mgmt) and uses this repository purely as a persistence
    // trail for reporting/backtest analysis.
    return undefined;
  }

  async getOpenPositions(): Promise<Position[]> {
    return [];
  }

  async allPositions(): Promise<Position[]> {
    return [];
  }
}

export class PrismaWatchlistRepository implements IWatchlistRepository {
  constructor(private readonly prisma: any) {}

  async load(): Promise<WatchlistEntry[]> {
    const rows = await this.prisma.watchlist.findMany();
    return rows.map((row: any) => ({ address: row.walletAddress, label: row.label, notes: row.notes }));
  }

  async add(entry: WatchlistEntry): Promise<void> {
    await this.prisma.watchlist.upsert({
      where: { walletAddress: entry.address },
      create: { walletAddress: entry.address, label: entry.label, notes: entry.notes },
      update: { label: entry.label, notes: entry.notes },
    });
  }
}

export class PrismaRiskStateRepository implements IRiskStateRepository {
  constructor(private readonly prisma: any) {}

  async get(): Promise<RiskState> {
    const row = await this.prisma.riskState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });
    return {
      dailyLossUsd: row.dailyLossUsd,
      dailyLossResetAt: row.dailyLossResetAt.getTime(),
      consecutiveLosses: row.consecutiveLosses,
      cooldownUntil: row.cooldownUntil ? row.cooldownUntil.getTime() : undefined,
      killSwitchActive: row.killSwitchActive,
    };
  }

  async update(partial: Partial<RiskState>): Promise<RiskState> {
    const row = await this.prisma.riskState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {
        dailyLossUsd: partial.dailyLossUsd,
        consecutiveLosses: partial.consecutiveLosses,
        killSwitchActive: partial.killSwitchActive,
        cooldownUntil: partial.cooldownUntil ? new Date(partial.cooldownUntil) : undefined,
      },
    });
    return {
      dailyLossUsd: row.dailyLossUsd,
      dailyLossResetAt: row.dailyLossResetAt.getTime(),
      consecutiveLosses: row.consecutiveLosses,
      cooldownUntil: row.cooldownUntil ? row.cooldownUntil.getTime() : undefined,
      killSwitchActive: row.killSwitchActive,
    };
  }
}

export function createPrismaRepositories(prisma: any): Repositories {
  return {
    wallet: new PrismaWalletRepository(prisma),
    token: new PrismaTokenRepository(prisma),
    trade: new PrismaTradeRepository(prisma),
    cluster: new PrismaClusterRepository(prisma),
    signal: new PrismaSignalRepository(prisma),
    position: new PrismaPositionRepository(prisma),
    watchlist: new PrismaWatchlistRepository(prisma),
    riskState: new PrismaRiskStateRepository(prisma),
  };
}
