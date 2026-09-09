/** Shared set of token mints that token-intel has flagged as rugged
 * (liquidity/price collapse). wallet-intel consults it when a wallet's
 * open position on a mint closes, to count rug exposure. */
export class RuggedTokenRegistry {
  private rugged = new Set<string>();

  flag(tokenMint: string): void {
    this.rugged.add(tokenMint);
  }

  isRugged(tokenMint: string): boolean {
    return this.rugged.has(tokenMint);
  }
}
