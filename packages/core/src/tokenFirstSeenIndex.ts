/** Tracks, for every token mint seen anywhere in the trade stream, the
 * block time of the first trade observed. Shared between wallet-intel
 * (early-entry frequency) and token-intel (token age) so both derive "how
 * new is this token" the same way, from the same event stream, with no
 * external dependency and no lookahead (a mint's first-seen time only ever
 * moves earlier by observing an event that actually happened earlier in
 * event order, never by peeking forward). */
export class TokenFirstSeenIndex {
  private firstSeen = new Map<string, number>();

  record(tokenMint: string, blockTime: number): void {
    const existing = this.firstSeen.get(tokenMint);
    if (existing === undefined || blockTime < existing) {
      this.firstSeen.set(tokenMint, blockTime);
    }
  }

  get(tokenMint: string): number | undefined {
    return this.firstSeen.get(tokenMint);
  }

  ageSeconds(tokenMint: string, atBlockTime: number): number | undefined {
    const first = this.firstSeen.get(tokenMint);
    if (first === undefined) return undefined;
    return Math.max(0, atBlockTime - first);
  }
}
