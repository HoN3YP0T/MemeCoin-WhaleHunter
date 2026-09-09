import type { DexName, RawFeedEvent, TradeSide } from "@whale-sniper/core";
import { mulberry32 } from "./rng.js";
import type { DecodableTradePayload } from "./txDecoder.js";

export interface ScenarioTokenMetadata {
  liquidityUsd: number;
  marketCapUsd: number;
  holderCount: number;
  top10HolderPct: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
}

export interface ScenarioResult {
  name: string;
  tokenMint: string;
  whaleWallet: string;
  tokenMetadata: ScenarioTokenMetadata;
  events: RawFeedEvent[];
}

let slotCounter = 1_000_000;
let txCounter = 0;

function mkEvent(
  payload: DecodableTradePayload,
  blockTime: number,
  receivedAtOffsetMs: number,
): RawFeedEvent {
  slotCounter += 1;
  txCounter += 1;
  return {
    provider: "mock",
    txSignature: `mockTx_${txCounter}_${payload.wallet.slice(0, 6)}`,
    slot: slotCounter,
    blockTime,
    raw: payload,
    receivedAt: blockTime * 1000 + receivedAtOffsetMs,
  };
}

function trade(
  wallet: string,
  tokenMint: string,
  side: TradeSide,
  tokenAmount: number,
  usdValue: number,
  priceUsd: number,
  blockTime: number,
  dex: DexName = "raydium",
  pool = `${tokenMint}-pool`,
): RawFeedEvent {
  return mkEvent(
    { wallet, tokenMint, side, tokenAmount, usdValue, priceUsd, dex, pool },
    blockTime,
    0,
  );
}

/**
 * Builds a wallet's historical track record: mostly-winning early round
 * trips across distinct, unique tokens, sized above the whale-buy floor.
 * Used to make `whaleWallet` pass the hard gate before the "live" part of a
 * scenario begins.
 */
function buildWinningHistory(
  wallet: string,
  startBlockTime: number,
  count: number,
  seed: number,
): RawFeedEvent[] {
  const rnd = mulberry32(seed);
  const events: RawFeedEvent[] = [];
  let t = startBlockTime;
  for (let i = 0; i < count; i++) {
    const historyMint = `HistTok_${wallet.slice(0, 8)}_${i}`;
    const isWin = rnd() > 0.18; // ~82% win rate
    const buyPrice = 1;
    const buyUsd = 3000 + rnd() * 3000; // 3000-6000, above minWhaleBuySizeUsd
    const buyAmount = buyUsd / buyPrice;
    // Buying the very first trade ever seen on historyMint = maximally early.
    events.push(trade(wallet, historyMint, "BUY", buyAmount, buyUsd, buyPrice, t));
    t += 30 + Math.floor(rnd() * 120);
    const roi = isWin ? 0.25 + rnd() * 0.9 : -0.05 - rnd() * 0.15;
    const sellPrice = buyPrice * (1 + roi);
    events.push(trade(wallet, historyMint, "SELL", buyAmount, buyAmount * sellPrice, sellPrice, t));
    t += 60 + Math.floor(rnd() * 300);
  }
  return events;
}

function independentBuyerWallet(scenario: string, i: number): string {
  return `Indep_${scenario}_${i}`;
}

/** Scenario A: a qualified whale buys early into a healthy, low-risk token,
 * independent buyers pile in behind it, price runs up, whale trims. Should
 * clear the entry gate and produce a winning paper trade. */
export function normalWhaleBuyScenario(seed = 1): ScenarioResult {
  const whaleWallet = "WhaLe1QcuratedGoodTraderAddress11111111111";
  const tokenMint = "GoodTok11111111111111111111111111111111111";
  const baseTime = 1_700_000_000;

  const history = buildWinningHistory(whaleWallet, baseTime - 100_000, 18, seed);

  const events: RawFeedEvent[] = [...history];
  let t = baseTime;

  // A couple of small independent buys establish the token exists.
  for (let i = 0; i < 2; i++) {
    events.push(trade(independentBuyerWallet("normal", i), tokenMint, "BUY", 500, 500, 1, t));
    t += 5;
  }

  // The whale buys early and big.
  events.push(trade(whaleWallet, tokenMint, "BUY", 4000, 4000, 1, t));
  const whaleEntryTime = t;
  t += 10;

  // Independent momentum follows the whale in, from distinct wallets.
  for (let i = 2; i < 6; i++) {
    events.push(trade(independentBuyerWallet("normal", i), tokenMint, "BUY", 300 + i * 50, (300 + i * 50) * 1.05, 1.05, t));
    t += 8;
  }

  // Price runs up; a later tick from another buyer confirms momentum.
  events.push(trade(independentBuyerWallet("normal", 6), tokenMint, "BUY", 400, 400 * 1.4, 1.4, t + 60));

  // Whale trims a modest amount later (does not trigger emergency exit).
  events.push(trade(whaleWallet, tokenMint, "SELL", 400, 400 * 1.6, 1.6, whaleEntryTime + 900));

  return {
    name: "normal-whale-buy",
    tokenMint,
    whaleWallet,
    tokenMetadata: {
      liquidityUsd: 60000,
      marketCapUsd: 250000,
      holderCount: 140,
      top10HolderPct: 0.32,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
    },
    events,
  };
}

/** Scenario B: the same qualified whale buys into a token that is actually a
 * coordinated rug set-up - concentrated, unrevoked authorities, thin
 * liquidity, a cluster of common-funder wallets buying in lockstep, then a
 * fast large dump. The entry gate must block this despite the whale being
 * individually qualified. */
export function rugScenario(seed = 2): ScenarioResult {
  const whaleWallet = "WhaLe1QcuratedGoodTraderAddress11111111111";
  const tokenMint = "RugTok222222222222222222222222222222222222";
  const baseTime = 1_700_100_000;

  const history = buildWinningHistory(whaleWallet, baseTime - 100_000, 18, seed);
  const events: RawFeedEvent[] = [...history];
  let t = baseTime;

  const clusterWallets = [0, 1, 2, 3].map((i) => `Cluster_rug_${i}`);
  // Common-funder-linked wallets buy within seconds of each other -
  // classic coordinated buying / concentrated ownership pattern.
  for (const w of clusterWallets) {
    events.push(trade(w, tokenMint, "BUY", 8000, 8000, 1, t, "pumpfun"));
    t += 2;
  }

  // The watchlisted whale gets pulled in too.
  events.push(trade(whaleWallet, tokenMint, "BUY", 4000, 4000, 1, t));
  t += 15;

  // Creator-associated wallet dumps almost immediately.
  events.push(trade(clusterWallets[0], tokenMint, "SELL", 7500, 7500 * 0.4, 0.4, t));
  t += 5;
  events.push(trade(clusterWallets[1], tokenMint, "SELL", 7500, 7500 * 0.3, 0.3, t));

  return {
    name: "rug",
    tokenMint,
    whaleWallet,
    tokenMetadata: {
      liquidityUsd: 4000,
      marketCapUsd: 15000,
      holderCount: 12,
      top10HolderPct: 0.88,
      mintAuthorityRevoked: false,
      freezeAuthorityRevoked: false,
    },
    events,
  };
}

/** Scenario C: several unaffiliated-looking wallets buy the same token
 * within a tight timing window (no single whale trigger) - used to exercise
 * cluster-detect's coordinated-buying flag independent of wallet scoring. */
export function clusterCoordinatedBuyScenario(seed = 3): ScenarioResult {
  const tokenMint = "ClusterTok3333333333333333333333333333333";
  const baseTime = 1_700_200_000;
  const wallets = [0, 1, 2, 3, 4].map((i) => `Cluster_coord_${i}`);
  const events: RawFeedEvent[] = [];
  let t = baseTime;
  for (const w of wallets) {
    events.push(trade(w, tokenMint, "BUY", 1500, 1500, 1, t, "meteora"));
    t += 3;
  }
  return {
    name: "cluster-coordinated-buy",
    tokenMint,
    whaleWallet: wallets[0],
    tokenMetadata: {
      liquidityUsd: 20000,
      marketCapUsd: 90000,
      holderCount: 40,
      top10HolderPct: 0.55,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
    },
    events,
  };
}

/** Scenario D: whale enters cleanly (clears the gate) then sells out in
 * escalating tranches post-entry - drives whale-exit's WARN/REDUCE/EMERGENCY
 * tiers. */
export function whaleExitScenario(seed = 4): ScenarioResult {
  const base = normalWhaleBuyScenario(seed);
  const tokenMint = "ExitTok4444444444444444444444444444444444";
  const whaleWallet = base.whaleWallet;
  const baseTime = 1_700_300_000;
  const history = buildWinningHistory(whaleWallet, baseTime - 100_000, 18, seed);
  const events: RawFeedEvent[] = [...history];
  let t = baseTime;

  for (let i = 0; i < 3; i++) {
    events.push(trade(independentBuyerWallet("exit", i), tokenMint, "BUY", 500, 500, 1, t));
    t += 5;
  }

  const entryAmount = 5000;
  events.push(trade(whaleWallet, tokenMint, "BUY", entryAmount, entryAmount, 1, t));
  t += 30;

  // Escalating sells: 12% (WARN), then cumulative 35% (REDUCE), then
  // cumulative 65% (EMERGENCY).
  events.push(trade(whaleWallet, tokenMint, "SELL", entryAmount * 0.12, entryAmount * 0.12 * 1.1, 1.1, t));
  t += 60;
  events.push(trade(whaleWallet, tokenMint, "SELL", entryAmount * 0.23, entryAmount * 0.23 * 1.05, 1.05, t));
  t += 60;
  events.push(trade(whaleWallet, tokenMint, "SELL", entryAmount * 0.3, entryAmount * 0.3 * 0.9, 0.9, t));

  return {
    name: "whale-exit",
    tokenMint,
    whaleWallet,
    tokenMetadata: {
      liquidityUsd: 60000,
      marketCapUsd: 250000,
      holderCount: 140,
      top10HolderPct: 0.32,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
    },
    events,
  };
}

export function allScenarios(): ScenarioResult[] {
  return [
    normalWhaleBuyScenario(),
    rugScenario(),
    clusterCoordinatedBuyScenario(),
    whaleExitScenario(),
  ];
}
