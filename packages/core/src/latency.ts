import type { EventTimestamps } from "./types/events.js";

const STAGE_ORDER: (keyof EventTimestamps)[] = [
  "rawReceivedAt",
  "decodedAt",
  "walletMatchedAt",
  "tokenLookupAt",
  "clusterCheckAt",
  "scoredAt",
  "signalAt",
  "riskCheckedAt",
  "orderBuiltAt",
  "filledAt",
  "confirmedAt",
  "notifiedAt",
];

/** Latency (ms) of each consecutive populated stage transition, plus a
 * `totalMs` from the first to the last populated timestamp. Missing stages
 * (e.g. a hot-path-only event that never reached intelligence) are simply
 * skipped rather than producing NaN gaps. */
export function computeStageLatencies(timestamps: EventTimestamps): Record<string, number> {
  const populated = STAGE_ORDER.filter((k) => timestamps[k] !== undefined).map((k) => [k, timestamps[k] as number] as const);
  const out: Record<string, number> = {};
  for (let i = 1; i < populated.length; i++) {
    const [prevKey] = populated[i - 1];
    const [key, value] = populated[i];
    const [, prevValue] = populated[i - 1];
    out[`${prevKey}->${key}`] = value - prevValue;
  }
  if (populated.length >= 2) {
    out.totalMs = populated[populated.length - 1][1] - populated[0][1];
  }
  return out;
}
