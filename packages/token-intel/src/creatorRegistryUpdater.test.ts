import { CreatorRegistry, EventBus, RuggedTokenRegistry } from "@whale-sniper/core";
import { InMemoryTokenRepository } from "@whale-sniper/db";
import { describe, expect, it } from "vitest";
import { CreatorRegistryUpdater } from "./creatorRegistryUpdater.js";

function baseStats(overrides: Partial<Parameters<InMemoryTokenRepository["upsertStats"]>[0]> = {}) {
  return {
    tokenMint: "T1",
    createdAt: 1000,
    liquidityUsd: 5000,
    marketCapUsd: 10000,
    holderCount: 50,
    top10HolderPct: 0.3,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    uniqueBuyers1h: 5,
    uniqueSellers1h: 1,
    buyVolumeUsd5m: 100,
    sellVolumeUsd5m: 10,
    buyVolumeUsd1h: 100,
    sellVolumeUsd1h: 10,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("CreatorRegistryUpdater", () => {
  it("does nothing when a token's creatorAddress is unknown", async () => {
    const bus = new EventBus();
    const tokenRepo = new InMemoryTokenRepository();
    const creatorRegistry = new CreatorRegistry();
    const ruggedRegistry = new RuggedTokenRegistry();
    await tokenRepo.upsertStats(baseStats({ creatorAddress: undefined }));

    const updater = new CreatorRegistryUpdater(bus, tokenRepo, creatorRegistry, ruggedRegistry);
    updater.start();
    bus.emit("token.stats-updated", { tokenMint: "T1" });
    await flush();

    expect(creatorRegistry.getReputation("C1")).toBeUndefined();
  });

  it("records a token observed exactly once per token even across repeated events", async () => {
    const bus = new EventBus();
    const tokenRepo = new InMemoryTokenRepository();
    const creatorRegistry = new CreatorRegistry();
    const ruggedRegistry = new RuggedTokenRegistry();
    await tokenRepo.upsertStats(baseStats({ creatorAddress: "C1" }));

    const updater = new CreatorRegistryUpdater(bus, tokenRepo, creatorRegistry, ruggedRegistry);
    updater.start();
    bus.emit("token.stats-updated", { tokenMint: "T1" });
    bus.emit("token.stats-updated", { tokenMint: "T1" });
    bus.emit("token.stats-updated", { tokenMint: "T1" });
    await flush();

    expect(creatorRegistry.getReputation("C1")?.tokensCreated).toBe(1);
  });

  it("records a rug against the creator exactly once, only after RuggedTokenRegistry flags it, without touching rug-detection logic itself", async () => {
    const bus = new EventBus();
    const tokenRepo = new InMemoryTokenRepository();
    const creatorRegistry = new CreatorRegistry();
    const ruggedRegistry = new RuggedTokenRegistry();
    await tokenRepo.upsertStats(baseStats({ creatorAddress: "C1" }));

    const updater = new CreatorRegistryUpdater(bus, tokenRepo, creatorRegistry, ruggedRegistry);
    updater.start();

    bus.emit("token.stats-updated", { tokenMint: "T1" });
    await flush();
    expect(creatorRegistry.getReputation("C1")?.tokensRugged).toBe(0);

    ruggedRegistry.flag("T1");
    bus.emit("token.stats-updated", { tokenMint: "T1" });
    bus.emit("token.stats-updated", { tokenMint: "T1" });
    await flush();

    expect(creatorRegistry.getReputation("C1")?.tokensRugged).toBe(1);
    expect(creatorRegistry.getReputation("C1")?.tokensCreated).toBe(1);
  });

  it("tracks separate creators independently across multiple tokens", async () => {
    const bus = new EventBus();
    const tokenRepo = new InMemoryTokenRepository();
    const creatorRegistry = new CreatorRegistry();
    const ruggedRegistry = new RuggedTokenRegistry();
    await tokenRepo.upsertStats(baseStats({ tokenMint: "T1", creatorAddress: "C1" }));
    await tokenRepo.upsertStats(baseStats({ tokenMint: "T2", creatorAddress: "C1" }));
    await tokenRepo.upsertStats(baseStats({ tokenMint: "T3", creatorAddress: "C2" }));

    const updater = new CreatorRegistryUpdater(bus, tokenRepo, creatorRegistry, ruggedRegistry);
    updater.start();
    bus.emit("token.stats-updated", { tokenMint: "T1" });
    bus.emit("token.stats-updated", { tokenMint: "T2" });
    bus.emit("token.stats-updated", { tokenMint: "T3" });
    await flush();

    expect(creatorRegistry.getReputation("C1")?.tokensCreated).toBe(2);
    expect(creatorRegistry.getReputation("C2")?.tokensCreated).toBe(1);
  });
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
