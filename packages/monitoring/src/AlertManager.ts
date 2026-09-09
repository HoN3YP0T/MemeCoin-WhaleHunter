import type { MetricsSnapshot } from "./MetricsStore.js";

export interface AlertThresholds {
  maxDrawdownPct: number;
  maxSlippagePctP95: number;
  minFeedHealthy: boolean;
  maxOrderFailureRate: number; // 0..1, over submitted
}

export const defaultAlertThresholds: AlertThresholds = {
  maxDrawdownPct: 25,
  maxSlippagePctP95: 8,
  minFeedHealthy: true,
  maxOrderFailureRate: 0.3,
};

export interface Alert {
  key: string;
  message: string;
}

/** Pure evaluation of a metrics snapshot against thresholds - callers
 * (wiring) decide how often to check and where alerts go (Telegram, logs). */
export function evaluateAlerts(snapshot: MetricsSnapshot, thresholds: AlertThresholds = defaultAlertThresholds): Alert[] {
  const alerts: Alert[] = [];

  if (snapshot.drawdownPct > thresholds.maxDrawdownPct) {
    alerts.push({ key: "drawdown", message: `Drawdown ${snapshot.drawdownPct.toFixed(1)}% exceeds max ${thresholds.maxDrawdownPct}%` });
  }

  if (snapshot.slippagePct.p95 > thresholds.maxSlippagePctP95) {
    alerts.push({
      key: "slippage",
      message: `P95 slippage ${snapshot.slippagePct.p95.toFixed(2)}% exceeds max ${thresholds.maxSlippagePctP95}%`,
    });
  }

  if (thresholds.minFeedHealthy) {
    for (const [provider, health] of Object.entries(snapshot.feed)) {
      if (!health.connected) alerts.push({ key: `feed-${provider}`, message: `Feed provider ${provider} is disconnected` });
    }
  }

  if (snapshot.ordersSubmitted > 0) {
    const failureRate = snapshot.ordersFailed / snapshot.ordersSubmitted;
    if (failureRate > thresholds.maxOrderFailureRate) {
      alerts.push({ key: "order-failures", message: `Order failure rate ${(failureRate * 100).toFixed(0)}% exceeds max ${(thresholds.maxOrderFailureRate * 100).toFixed(0)}%` });
    }
  }

  return alerts;
}

/** Debounces repeated alerts of the same key so a persistent condition
 * doesn't spam Telegram on every check interval. */
export class AlertManager {
  private lastFired = new Map<string, number>();

  constructor(
    private readonly notify: (message: string) => void,
    private readonly cooldownMs = 5 * 60 * 1000,
  ) {}

  check(snapshot: MetricsSnapshot, thresholds: AlertThresholds = defaultAlertThresholds): Alert[] {
    const alerts = evaluateAlerts(snapshot, thresholds);
    const now = Date.now();
    const fired: Alert[] = [];
    for (const alert of alerts) {
      const last = this.lastFired.get(alert.key);
      if (last !== undefined && now - last < this.cooldownMs) continue;
      this.lastFired.set(alert.key, now);
      this.notify(`🚨 ${alert.message}`);
      fired.push(alert);
    }
    return fired;
  }
}
