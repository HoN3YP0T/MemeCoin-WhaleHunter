import { EventBus } from "@whale-sniper/core";
import { RecentEventLog } from "@whale-sniper/dashboard";
import { describe, expect, it } from "vitest";

describe("RecentEventLog", () => {
  it("captures both generated and rejected signals in chronological order, most-recent first", () => {
    const bus = new EventBus();
    const log = new RecentEventLog();
    log.start(bus);

    bus.emit("signal.generated", { signalId: "s1", tokenMint: "T1", score: 80 });
    bus.emit("signal.rejected", { tokenMint: "T2", reason: "liquidity too low" });
    bus.emit("signal.generated", { signalId: "s2", tokenMint: "T3", score: 90 });

    const recent = log.recent();
    expect(recent).toHaveLength(3);
    expect(recent[0]).toMatchObject({ kind: "generated", signalId: "s2", tokenMint: "T3", score: 90 });
    expect(recent[1]).toMatchObject({ kind: "rejected", tokenMint: "T2", reason: "liquidity too low" });
    expect(recent[2]).toMatchObject({ kind: "generated", signalId: "s1", tokenMint: "T1", score: 80 });
  });

  it("caps at the configured capacity, dropping the oldest events", () => {
    const bus = new EventBus();
    const log = new RecentEventLog(3);
    log.start(bus);

    for (let i = 0; i < 5; i++) {
      bus.emit("signal.generated", { signalId: `s${i}`, tokenMint: "T", score: i });
    }

    const recent = log.recent();
    expect(recent).toHaveLength(3);
    // newest-first: last emitted (s4) down to the oldest surviving (s2)
    expect(recent.map((e) => e.signalId)).toEqual(["s4", "s3", "s2"]);
  });

  it("respects a limit passed to recent()", () => {
    const bus = new EventBus();
    const log = new RecentEventLog();
    log.start(bus);
    bus.emit("signal.generated", { signalId: "s1", tokenMint: "T", score: 1 });
    bus.emit("signal.generated", { signalId: "s2", tokenMint: "T", score: 2 });

    expect(log.recent(1)).toHaveLength(1);
  });

  it("stops updating once unsubscribed", () => {
    const bus = new EventBus();
    const log = new RecentEventLog();
    const stop = log.start(bus);
    stop();
    bus.emit("signal.generated", { signalId: "s1", tokenMint: "T", score: 1 });
    expect(log.recent()).toHaveLength(0);
  });
});
