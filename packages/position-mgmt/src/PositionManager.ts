import type { EventBus, Position, StrategyConfig } from "@whale-sniper/core";
import type { IPositionRepository } from "@whale-sniper/db";
import { applyPaperExit } from "@whale-sniper/paper-trading";
import { applyPriceTick, decideNextAction, markTakeProfitFilled } from "./positionStateMachine.js";

const MAX_ACTIONS_PER_TICK = 10; // guards against any pathological infinite loop

/** Drives the TP ladder / trailing stop / max-hold state machine off price
 * ticks, executing (and persisting) whatever fills the state machine
 * decides on. */
export class PositionManager {
  constructor(
    private readonly bus: EventBus,
    private readonly repo: IPositionRepository,
    private readonly config: StrategyConfig,
  ) {}

  async onPriceTick(position: Position, priceUsd: number, liquidityUsd: number, nowMs: number = Date.now()): Promise<Position> {
    if (position.status === "CLOSED") return position;

    applyPriceTick(position, priceUsd, this.config);

    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) {
      const outcome = decideNextAction(position, this.config, nowMs);
      if (outcome.kind === "NO_ACTION") break;

      if (outcome.kind === "PARTIAL_EXIT") {
        applyPaperExit(position, priceUsd, outcome.sellFraction, liquidityUsd, this.config, outcome.reason);
        markTakeProfitFilled(position, outcome.triggerPct);
        await this.repo.savePosition(position);
        this.bus.emit("position.updated", { positionId: position.positionId });
      } else {
        applyPaperExit(position, priceUsd, 1, liquidityUsd, this.config, outcome.reason);
        await this.repo.savePosition(position);
        this.bus.emit("position.closed", { positionId: position.positionId, reason: outcome.reason });
        break;
      }
    }

    if (position.status === "OPEN") {
      await this.repo.savePosition(position);
    }
    return position;
  }
}
