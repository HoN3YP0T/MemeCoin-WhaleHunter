# MemeCoin WhaleHunter

A Solana memecoin "whale-entry sniper" trading engine scaffold: detects
high-quality whale buys, scores the whale and the token, filters out
manipulation, combines everything into a deterministic composite signal, and
manages a position end-to-end (paper trading first, live execution gated).

The whole pipeline runs today against a deterministic **mock feed** with no
real Solana RPC/Geyser credentials, no Telegram bot token, and no live
wallet required. Paper trading is the primary, fully-tested path. Live
execution is structurally complete but explicitly gated off.

## Quick start

```bash
npm install
npm run test          # unit + integration tests, no external services needed
npm run start         # boots the mock feed and runs the full pipeline in-process
npm run backtest       # replays the mock scenarios through the same pipeline and prints a report
```

Optional, if you have Docker available:

```bash
docker compose up -d
npx prisma migrate dev --name init --schema packages/db/prisma/schema.prisma
npm run seed:watchlist
```

If Postgres/Prisma isn't reachable (no Docker, no `DATABASE_URL`), every
repository call falls back to an in-memory implementation automatically -
`npm run test`, `npm run start`, and `npm run backtest` all work either way.

## Architecture

npm workspaces monorepo, TypeScript on Node 22, `tsx` for running/testing
(no separate build step). Each package under `packages/*` is a real
workspace package (`@whale-sniper/<name>`) with its own `package.json`.

```
packages/
  core            shared types, zod-validated config/env, typed event bus,
                   logger, real/simulated Clock, latency helpers
  db              Prisma schema + repositories (in-memory and Prisma-backed)
  feed            IFeedProvider, MockFeedProvider + scenario generators,
                   real HeliusFeedProvider (pump.fun, opt-in), tx decoder,
                   FeedManager
  wallet-intel    watchlist loader + state machine (WatchlistIndex),
                   walletStatsUpdater, walletScoring.ts
  token-intel     token stats/metadata collector (mock, or real DexScreener
                   /Solscan adapters, opt-in), tokenRiskScoring.ts,
                   CreatorRegistryUpdater
  cluster-detect  wallet relationship graph, union-find clustering, flags
  signal-engine   composite signal score, entryGate.ts
  paper-trading   fill simulator, paper trade engine
  execution       IExecutionAdapter, paper + live adapters, risk engine,
                   execution pipeline
  position-mgmt   TP ladder / trailing stop / max-hold state machine
  whale-exit      post-entry whale monitoring, tiered response
  whale-discovery WhaleDiscoveryEngine - auto-promotes/pends
                   never-before-seen wallets onto the watchlist (opt-in)
  telegram-bot    grammy bot: notifications + control commands, plus
                   /candidates /approve /reject for whale-discovery
  monitoring      in-memory metrics, alerting, /health + /metrics
  orchestrator    the single canonical pipeline wiring, shared by the live
                   app and the backtest replay engine
  backtest        replay engine, parameter sweep, report builder

apps/
  sniper-runner   composition root (main.ts + wiring.ts)

scripts/          seed-watchlist.ts, run-backtest.ts
config/           strategy.json (all thresholds/weights), watchlist.json
tests/
  unit/           one file per package's core logic
  integration/    pipeline.e2e.test.ts, backtest.test.ts
```

## Phase -> package map

| Phase | What | Package(s) |
|---|---|---|
| 1 | Core types, config, event bus, feed interface + mock provider | `core`, `feed` |
| 2 | Persistence + wallet stats tracking | `db`, `wallet-intel` |
| 3 | Whale Score formula | `wallet-intel` (`walletScoring.ts`) |
| 4 | Token stats + risk scoring | `token-intel` |
| 5 | Cluster/manipulation detection | `cluster-detect` |
| 6 | Composite signal + entry gate | `signal-engine` |
| 7 | Paper trading | `paper-trading` |
| 8 | Backtesting | `backtest` |
| 9 | Execution (paper-first) | `execution` |
| 10 | Position management | `position-mgmt` |
| 11 | Risk engine + whale-exit monitoring, gated live adapter | `execution`, `whale-exit` |
| 12 | Telegram notifications/control | `telegram-bot` |
| 13 | Monitoring | `monitoring` |
| 14 | Composition root + end-to-end proof | `orchestrator`, `apps/sniper-runner`, `tests/integration` |

## Data flow

Every `NormalizedTradeEvent` carries a `timestamps` object stamped through
each pipeline stage it passes: `rawReceivedAt -> decodedAt -> walletMatchedAt
-> tokenLookupAt -> clusterCheckAt -> scoredAt -> signalAt -> riskCheckedAt ->
orderBuiltAt -> filledAt -> confirmedAt -> notifiedAt`. Stages 0-2 are the
allocation-light hot path; everything from `tokenLookupAt` onward only runs
for whale BUYs from watchlisted wallets. `core/latency.ts` turns these into
per-stage latencies that `monitoring` aggregates.

## Scoring

- **Whale Score** (0-100): `0.25*Consistency + 0.20*Timing +
  0.15*Selectivity + 0.20*ExitQuality + 0.10*RugAvoidance +
  0.10*RecentPerformance`. Consistency uses a Bayesian-shrunk win rate
  (prior 3/6) scaled by a trade-count confidence factor, so a wallet with 8
  trades at 75% doesn't outscore one with 200 trades at 64%.
- **Token Risk Score** (0-100, higher = riskier): weighted age /
  liquidity / concentration / authority / buyer-diversity / flow / creator
  risk. `creatorRisk` ships at weight 0 (see "Creator reputation" below) -
  computed and visible on every score, contributing nothing until an
  operator deliberately rebalances the weights.
- **Cluster/manipulation**: a weighted-edge wallet relationship graph
  (common funder, direct transfer, repeated co-buy, timing correlation,
  shared creator) merged via union-find, producing five manipulation flags
  and a capped penalty fed into the signal score.
- **Composite Signal Score** (0-100): `0.30*whaleQuality + 0.20*tokenQuality
  + 0.15*liquidity + 0.10*buyingMomentum + 0.10*independentBuyers +
  0.10*earlyEntryQuality - 0.05*manipulationPenalty`.
- **Entry Gate**: a hard AND across every independent safeguard (qualified
  whale, token risk bound, liquidity floor, no active manipulation flag,
  buyer/momentum floors, slippage bound, signal score floor, risk engine
  veto) - "never trade on a single whale buy blindly".

All thresholds and weights live in `config/strategy.json`, zod-validated at
boot, and are what `backtest`'s parameter sweep recalibrates.

`tokenThresholds.allowedDexes` gates which venue the triggering trade
happened on - it includes both `"pumpfun"` and `"raydium"` by default,
since the same token trades on pump.fun's own bonding curve pre-migration
and on Raydium once it clears pump.fun's ~$69k migration market cap; both
are legitimate places to catch a whale entry over a token's lifecycle.
`minLiquidityUsd` (4000) and `minAgeSeconds` (30) are tuned for pump.fun's
actual launch profile - fresh launches routinely start with low-thousands
liquidity and are tradeable within seconds, so the higher defaults this
scaffold shipped with originally would reject almost everything on that
venue. `maxAgeSeconds` (21600, 6h) is a new upper bound: a whale *entry*
sniper should be catching fresh discovery, not opening a position hours
into an already-mature pump.

## Real integrations

All three of these are fully implemented, not stubs, and all three are off
by default - nothing about the mock-feed/mock-token-stats path above
changes unless you explicitly opt in.

**DexScreener token data** (`TOKEN_DATA_PROVIDER=dexscreener` in `.env`) -
`DexScreenerTokenMetadataProvider` (`packages/token-intel`) calls
DexScreener's free, no-API-key public API for a token's liquidity and
market cap, short-TTL cached per mint so the hot trade path never blocks
on network I/O. DexScreener has no holder count, concentration, or
mint/freeze authority data, so those fields fall back to conservative
"treat as risky" defaults (authorities read as *not revoked*) rather than
a guess - see the comment on `conservativeUnknownSeed` in
`tokenMetadataProvider.ts` (shared by DexScreener's and Solscan's adapters,
so the fallback never drifts between them). No env var is required beyond
the flag itself; DexScreener needs no key.

**Solscan token data** (`TOKEN_DATA_PROVIDER=solscan` in `.env`, plus
`SOLSCAN_API_KEY`) - `SolscanTokenMetadataProvider` (`packages/token-intel`)
calls Solscan's paid Pro API v2.0 (`token/meta`, `token/holders`, and an
account-activity lookup) and, unlike DexScreener, can supply holder count,
top-10 concentration, and mint/freeze authority state directly, plus two
fields DexScreener has no concept of at all: `creatorAddress` (who deployed
the token) and `creatorTokenLaunchCount` (a serial-deployer signal). If
`TOKEN_DATA_PROVIDER=solscan` is set and `SOLSCAN_API_KEY` is empty, the app
refuses to start (`wiring.ts`'s `buildTokenMetadataProvider()`), mirroring
Helius's fail-fast contract below. **Honesty note**: this build has no live
Solscan key to test against, so the exact endpoint paths and response field
names in `solscanTokenMetadataProvider.ts` are best-effort, written against
Solscan's documented v2.0 shape - see the HONESTY NOTE at the top of that
file before relying on it in production. Unlike the other four metadata
fields, an unknown `creatorTokenLaunchCount` (Solscan outage, or a provider
that doesn't support it) deliberately defaults to *neutral* (0 risk
contribution), not risky - a brand-new first-time creator is normal, and
missing data shouldn't punish every token equally.

**Helius live feed** (`FEED_PROVIDER=helius` in `.env`, plus
`HELIUS_API_KEY`) - `HeliusFeedProvider` (`packages/feed`) subscribes to
real pump.fun buy/sell activity over Helius's RPC/WS using
`Connection.onLogs` against pump.fun's bonding-curve program, and decodes
the on-chain `TradeEvent` logs into the same `NormalizedTradeEvent` shape
the mock feed produces. If `FEED_PROVIDER=helius` is set and
`HELIUS_API_KEY` is empty, the app refuses to start (`wiring.ts`'s
`buildFeedProvider()`) rather than silently falling back to the mock feed.
Get a key at https://helius.dev. See `HeliusFeedProvider.ts` and
`pumpFunDecoder.ts` for the documented judgment calls this integration
makes without a live key to verify against (which subscription approach
was used and why, the trade-event byte layout, and the lack of a live
SOL/USD price oracle).

## Creator reputation

Two existing gaps turned out to correlate rather than needing two separate
bolt-ons: token risk scoring couldn't see who deployed a token, and the
bot's own rug detection never fed back into anything. Concretely, the loop
is:

1. `SolscanTokenMetadataProvider` puts a real `creatorAddress` +
   `creatorTokenLaunchCount` onto `TokenStats`, when it can resolve one.
2. The existing, **unmodified** rug detector - `TokenStatsCollector`'s
   liquidity-crash logic flagging `RuggedTokenRegistry` - keeps working
   exactly as it always has. A new `CreatorRegistryUpdater`
   (`packages/token-intel`) just listens to the already-emitted
   `token.stats-updated` event and, when a token it knows the creator of
   gets flagged rugged, increments that creator's `tokensRugged` count in a
   new persistent `CreatorRegistry` (`packages/core`).
3. `creatorRiskComponent()` in `tokenRiskScoring.ts` blends that
   self-learned rug rate (confidence-shrunk the same way `walletScoring.ts`
   shrinks small-sample wallet data) with Solscan's serial-deployer
   launch-count signal into `TokenRiskScore.creatorRisk` - computed and
   visible from day one, but contributing nothing to the score while
   `tokenRiskWeights.creatorRisk` stays at its shipped default of `0`.
   Recommended rebalanced split when turning it on: `age .20, liquidity
   .18, concentration .18, authority .12, buyerDiversity .08, flow .08,
   creatorRisk .16` (sums to 1.00).
4. `TokenRiskScore` already gates every entry (`signal-engine/entryGate.ts`)
   for every whale buy that reaches it, watchlisted or auto-discovered
   alike, since it's the same function call either way.
5. Which tokens whales win or get rugged on already feeds
   `WalletStats.rugExposureCount` (unchanged) -> `rugAvoidanceScore()` ->
   10% of Whale Score - so creator reputation, wallet reputation, and token
   risk all stay connected through data the bot already collects.

`CreatorRegistry` is hydrated from `repos.creatorReputation` at boot
(`wiring.ts`) so reputation survives restarts.

## Whale auto-discovery

Whale-finding was 100% manual: `SniperOrchestrator` only ever scored/traded
wallets already in the static `config/watchlist.json`. `WhaleDiscoveryEngine`
(`packages/whale-discovery`) closes that gap - off by default
(`config/strategy.json`'s `walletDiscovery.enabled: false`).

The watchlist is now a small state machine (`WatchlistEntry.status`:
`"pending" | "active" | "rejected"`, `.source`: `"manual" |
"auto-discovered"`) - existing entries default to `{status: "active",
source: "manual"}` via `normalizeWatchlistEntry()`, so `config/watchlist.json`
and every existing test/fixture behave exactly as before. Only `"active"`
entries are tradeable (`WatchlistIndex.isWatched()`).

When enabled, `WhaleDiscoveryEngine` watches every wallet's trade activity
(not just watchlisted ones) for a never-before-seen wallet. It reuses
`scoreWallet()`/`evaluateHardGate()` from `walletScoring.ts`
**byte-for-byte unchanged** - a wallet only gets auto-promoted if it clears
the identical bar a manually curated wallet has to clear, no second, laxer
rulebook. A candidate that clears the gate is then checked against
`ClusterDetector`'s manipulation flags for the triggering token; a wallet in
a cluster flagged `creatorAssociatedWallets` or `coordinatedBuying` is
auto-rejected regardless of score. A candidate that clears both checks goes
to:

- `"active"` immediately (and a `wallet.discovery-promoted` event fires) if
  `walletDiscovery.autoPromote: true`, or
- `"pending"` (and a `wallet.discovery-candidate` event fires) otherwise,
  awaiting operator review.

Telegram (only relevant when `TELEGRAM_BOT_TOKEN` is set - see "Telegram"
below) gets three new commands: `/candidates` lists everything pending,
`/approve <address>` and `/reject <address>` move a candidate to
`"active"`/`"rejected"`, updating both the persisted watchlist and the live
in-process index immediately.

To try it: set `walletDiscovery.enabled: true` (and optionally
`autoPromote: true`) in `config/strategy.json` and run `npm run start` - do
not commit that change, the shipped default is off.

## Live trading

`LIVE_TRADING_ENABLED=false` by default in `.env.example`. The execution
pipeline only ever selects `PaperExecutionAdapter` unless
`LIVE_TRADING_ENABLED=true` **and** a distinct `HOT_WALLET_KEYPAIR_PATH`
**and** a positive `HOT_WALLET_MAX_BALANCE_USD` are all configured -
`selectExecutionAdapterKind()` in `packages/execution` is the single choke
point for that decision. Even when constructible, `LiveExecutionAdapter`'s
`submitOrder` always throws "not implemented" in this build: signing and
on-chain submission require a real wallet/RPC integration that is
intentionally out of scope here.

To eventually enable live trading you would need: a real feed provider (see
"Real integrations" above - `HeliusFeedProvider` is a complete
implementation now, just gated behind `FEED_PROVIDER=helius` +
`HELIUS_API_KEY`), a funded, dedicated hot wallet kept separate from any
other wallet, and a completed `LiveExecutionAdapter.submitOrder`
implementation - then set `LIVE_TRADING_ENABLED=true`,
`HOT_WALLET_KEYPAIR_PATH`, and `HOT_WALLET_MAX_BALANCE_USD` in `.env`.

## Telegram

`telegram-bot` only starts if `TELEGRAM_BOT_TOKEN` is set; otherwise it's a
no-op and everything else keeps working. Commands (`/status /positions /pnl
/signals /pause /resume /kill /candidates /approve /reject`) only read
repositories and flip runtime flags (or, for `/approve` and `/reject`,
update watchlist status) - they never call execution or position management
directly. `/candidates`, `/approve`, and `/reject` are whale-discovery's
review workflow - see "Whale auto-discovery" above.
