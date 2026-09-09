import type { EventBus, Logger, RuntimeFlags } from "@whale-sniper/core";
import type { IPositionRepository, ISignalRepository } from "@whale-sniper/db";
import { Bot } from "grammy";
import { formatEntry, formatExit, formatSignalRejected, formatWhaleDetected, formatWhaleExit } from "./notifications.js";

export interface TelegramBotDeps {
  token: string;
  chatId: string;
  bus: EventBus;
  positionRepo: IPositionRepository;
  signalRepo: ISignalRepository;
  runtimeFlags: RuntimeFlags;
  logger: Logger;
}

/**
 * Notifications/control only - never in the execution critical path.
 * Commands read repositories and flip runtime flags; they never call
 * execution or position management directly. If TELEGRAM_BOT_TOKEN is
 * unset, `start()` simply does not start anything and every other package
 * keeps working.
 */
export class TelegramBot {
  private bot: Bot | undefined;
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: TelegramBotDeps) {}

  async start(): Promise<void> {
    if (!this.deps.token) {
      this.deps.logger.info({}, "TELEGRAM_BOT_TOKEN not set - telegram-bot disabled");
      return;
    }

    this.bot = new Bot(this.deps.token);
    this.registerCommands(this.bot);
    this.registerNotifications();

    // Long-polling - intentionally not awaited by the caller.
    void this.bot.start({
      onStart: () => this.deps.logger.info({}, "telegram bot started"),
    });
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) unsub();
    await this.bot?.stop();
  }

  private registerCommands(bot: Bot): void {
    bot.command("status", async (ctx) => {
      const flags = this.deps.runtimeFlags;
      const open = await this.deps.positionRepo.getOpenPositions();
      await ctx.reply(
        `Status: ${flags.killed ? "KILLED" : flags.paused ? "PAUSED" : "RUNNING"}\nOpen positions: ${open.length}`,
      );
    });

    bot.command("positions", async (ctx) => {
      const open = await this.deps.positionRepo.getOpenPositions();
      if (open.length === 0) {
        await ctx.reply("No open positions.");
        return;
      }
      const lines = open.map(
        (p) => `${p.tokenMint.slice(0, 8)}... entry $${p.entryPriceUsd.toFixed(6)} unrealized $${p.unrealizedPnlUsd.toFixed(2)}`,
      );
      await ctx.reply(lines.join("\n"));
    });

    bot.command("pnl", async (ctx) => {
      const all = await this.deps.positionRepo.allPositions();
      const realized = all.reduce((s, p) => s + p.realizedPnlUsd, 0);
      const closed = all.filter((p) => p.status === "CLOSED").length;
      await ctx.reply(`Realized PnL: $${realized.toFixed(2)} across ${closed} closed positions`);
    });

    bot.command("signals", async (ctx) => {
      const recent = await this.deps.signalRepo.recentSignals(5);
      if (recent.length === 0) {
        await ctx.reply("No recent signals.");
        return;
      }
      await ctx.reply(recent.map((s) => `${s.tokenMint.slice(0, 8)}... score ${s.score.toFixed(1)}`).join("\n"));
    });

    bot.command("pause", async (ctx) => {
      this.deps.runtimeFlags.pause();
      await ctx.reply("Trading paused.");
    });

    bot.command("resume", async (ctx) => {
      this.deps.runtimeFlags.resume();
      await ctx.reply("Trading resumed.");
    });

    bot.command("kill", async (ctx) => {
      this.deps.runtimeFlags.kill();
      await ctx.reply("Kill switch engaged. Trading halted for this session.");
    });
  }

  private registerNotifications(): void {
    const send = async (text: string) => {
      if (!this.deps.chatId || !this.bot) return;
      try {
        await this.bot.api.sendMessage(this.deps.chatId, text);
      } catch (err) {
        this.deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to send telegram notification");
      }
    };

    this.unsubscribers.push(
      this.deps.bus.on("whale.detected", async ({ wallet, tokenMint, usdValue, whaleScore }) => {
        await send(formatWhaleDetected(wallet, tokenMint, usdValue, whaleScore));
      }),
    );
    this.unsubscribers.push(
      this.deps.bus.on("position.closed", async ({ positionId }) => {
        const position = await this.deps.positionRepo.getPosition(positionId);
        if (position) await send(formatExit(position));
      }),
    );
    this.unsubscribers.push(
      this.deps.bus.on("position.opened", async ({ positionId }) => {
        const position = await this.deps.positionRepo.getPosition(positionId);
        if (!position) return;
        const signal = await this.deps.signalRepo.getSignal(position.signalId);
        if (signal) await send(formatEntry(position, signal));
      }),
    );
    this.unsubscribers.push(
      this.deps.bus.on("whale.exit-detected", async ({ wallet, tokenMint, pctSold }) => {
        await send(formatWhaleExit(wallet, tokenMint, pctSold));
      }),
    );
    this.unsubscribers.push(
      this.deps.bus.on("signal.rejected", async ({ tokenMint, reason }) => {
        await send(formatSignalRejected(tokenMint, reason));
      }),
    );
  }
}
