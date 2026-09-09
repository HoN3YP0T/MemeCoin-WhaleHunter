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
                   stub HeliusFeedProvider, tx decoder, FeedManager
  wallet-intel    watchlist loader, walletStatsUpdater, walletScoring.ts
  token-intel     mocked token stats/metadata collector, tokenRiskScoring.ts
  cluster-detect  wallet relationship graph, union-find clustering, flags
  signal-engine   composite signal score, entryGate.ts
  paper-trading   fill simulator, paper trade engine
  execution       IExecutionAdapter, paper + live adapters, risk engine,
                   execution pipeline
  position-mgmt   TP ladder / trailing stop / max-hold state machine
  whale-exit      post-entry whale monitoring, tiered response
  telegram-bot    grammy bot: notifications + control commands
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
  liquidity / concentration / authority / buyer-diversity / flow risk.
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

To eventually enable live trading you would need: a real feed provider
(implement `IFeedProvider` the way `HeliusFeedProvider`'s stub is shaped),
a funded, dedicated hot wallet kept separate from any other wallet, and a
completed `LiveExecutionAdapter.submitOrder` implementation - then set
`LIVE_TRADING_ENABLED=true`, `HOT_WALLET_KEYPAIR_PATH`, and
`HOT_WALLET_MAX_BALANCE_USD` in `.env`.

## Telegram

`telegram-bot` only starts if `TELEGRAM_BOT_TOKEN` is set; otherwise it's a
no-op and everything else keeps working. Commands (`/status /positions /pnl
/signals /pause /resume /kill`) only read repositories and flip runtime
flags - they never call execution or position management directly.
