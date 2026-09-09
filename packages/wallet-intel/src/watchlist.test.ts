import type { WatchlistEntry } from "@whale-sniper/db";
import { describe, expect, it } from "vitest";
import { WatchlistIndex } from "./watchlist.js";

describe("WatchlistIndex", () => {
  it("defaults entries with no status/source to active/manual (backward compatibility)", () => {
    const index = new WatchlistIndex();
    index.load([{ address: "W1", label: "curated" }]);

    expect(index.isWatched("W1")).toBe(true);
    expect(index.statusOf("W1")).toBe("active");
  });

  it("treats a pending entry as not watched", () => {
    const index = new WatchlistIndex();
    index.load([{ address: "W1", status: "pending", source: "auto-discovered" }]);

    expect(index.isWatched("W1")).toBe(false);
    expect(index.statusOf("W1")).toBe("pending");
  });

  it("treats a rejected entry as not watched", () => {
    const index = new WatchlistIndex();
    index.load([{ address: "W1", status: "rejected", source: "auto-discovered" }]);

    expect(index.isWatched("W1")).toBe(false);
    expect(index.statusOf("W1")).toBe("rejected");
  });

  it("returns undefined status for a wallet with no entry at all", () => {
    const index = new WatchlistIndex();
    index.load([]);

    expect(index.statusOf("unknown-wallet")).toBeUndefined();
    expect(index.isWatched("unknown-wallet")).toBe(false);
  });

  it("upsert adds a new entry and defaults its status/source when omitted", () => {
    const index = new WatchlistIndex();
    index.load([]);
    index.upsert({ address: "W2" });

    expect(index.isWatched("W2")).toBe(true);
    expect(index.statusOf("W2")).toBe("active");
  });

  it("upsert overwrites an existing entry's status (e.g. pending -> active on promotion)", () => {
    const index = new WatchlistIndex();
    index.load([{ address: "W1", status: "pending", source: "auto-discovered" }]);
    expect(index.isWatched("W1")).toBe(false);

    index.upsert({ address: "W1", status: "active", source: "auto-discovered" });
    expect(index.isWatched("W1")).toBe(true);
  });

  it("size() reflects the number of distinct entries", () => {
    const index = new WatchlistIndex();
    const entries: WatchlistEntry[] = [{ address: "A" }, { address: "B" }, { address: "C", status: "rejected" }];
    index.load(entries);
    expect(index.size()).toBe(3);
  });
});
