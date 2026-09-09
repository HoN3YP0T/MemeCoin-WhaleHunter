import { EventBus } from "@whale-sniper/core";
import { AlertManager, defaultAlertThresholds, evaluateAlerts, MetricsStore } from "@whale-sniper/monitoring";
import { describe, expect, it } from "vitest";

describe("MetricsStore", () => {
  it("tracks latency percentiles and order/signal counters via the event bus", () => {
    const bus = new EventBus();
    const metrics = new MetricsStore();
    metrics.start(bus);

    metrics.recordLatency("decode", 10);
    metrics.recordLatency("decode", 20);
    metrics.recordLatency("decode", 30);
    bus.emit("signal.rejected", { tokenMint: "T", reason: "test" });
    bus.emit("position.opened", { positionId: "p1", tokenMint: "T" });
    bus.emit("position.closed", { positionId: "p1", reason: "TAKE_PROFIT" });

    const snap = metrics.snapshot();
    expect(snap.signalsRejected).toBe(1);
    expect(snap.closedPositions).toBe(1);
    expect(snap.openPositions).toBe(0);
    expect(snap.latencyMsByStage.decode.count).toBe(3);
    expect(snap.latencyMsByStage.decode.avg).toBeCloseTo(20, 5);
  });

  it("computes drawdown from a peak/current equity curve", () => {
    const metrics = new MetricsStore();
    metrics.recordRealizedPnl(1000);
    metrics.recordRealizedPnl(-400);
    const snap = metrics.snapshot();
    expect(snap.drawdownPct).toBeCloseTo(40, 5);
  });
});

describe("alerting", () => {
  it("raises an alert when drawdown exceeds the threshold", () => {
    const metrics = new MetricsStore();
    metrics.recordRealizedPnl(1000);
    metrics.recordRealizedPnl(-500); // 50% drawdown
    const alerts = evaluateAlerts(metrics.snapshot(), { ...defaultAlertThresholds, maxDrawdownPct: 25 });
    expect(alerts.some((a) => a.key === "drawdown")).toBe(true);
  });

  it("debounces repeated alerts within the cooldown window", () => {
    const metrics = new MetricsStore();
    metrics.recordRealizedPnl(1000);
    metrics.recordRealizedPnl(-500);
    const messages: string[] = [];
    const manager = new AlertManager((msg) => messages.push(msg), 60000);

    manager.check(metrics.snapshot(), { ...defaultAlertThresholds, maxDrawdownPct: 25 });
    manager.check(metrics.snapshot(), { ...defaultAlertThresholds, maxDrawdownPct: 25 });

    expect(messages.length).toBe(1);
  });
});
