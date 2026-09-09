import { describe, expect, it } from "vitest";
import { MockFeedProvider } from "./MockFeedProvider.js";
import { normalWhaleBuyScenario } from "./scenarios.js";

describe("MockFeedProvider", () => {
  it("emits fully-timestamped normalized events for a scenario script", async () => {
    const scenario = normalWhaleBuyScenario();
    const received: unknown[] = [];
    const provider = new MockFeedProvider(scenario.events, { playback: "instant" });
    provider.onEvent((event) => received.push(event));
    await provider.connect();

    expect(received.length).toBe(scenario.events.length);
    const first = received[0] as { timestamps: { rawReceivedAt: number; decodedAt?: number } };
    expect(first.timestamps.rawReceivedAt).toBeTypeOf("number");
    expect(first.timestamps.decodedAt).toBeTypeOf("number");
    expect(provider.health().eventsReceived).toBe(scenario.events.length);
  });
});
